import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { localOcrFromUpload, localVisionObservationsFromUpload, type VisionOcrObservation } from "../_lib/local-ocr";

const SYSTEM = `You are extracting calendar events from a screenshot of a weekly calendar view.

Return ONLY a valid JSON array of day blocks. No explanation, no markdown, just the raw array.

Format:
[
  {
    "day": "Monday",
    "events": [
      { "time": "9:00 AM", "task": "Team standup", "note": "" }
    ]
  }
]

Rules:
- Include one object per day that has timed events visible. Skip days with no events.
- The "day" field must be a full day name: "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
- Use 12-hour time format with AM/PM for every time (e.g. "9:00 AM", "12:30 PM", "3:00 PM").
- The "time" field is the START TIME ONLY. If an event runs 11:00–12:30, write "11:00 AM". Never write a range.
- Only include events with a specific time. Skip all-day events.
- Task names must be specific and readable. "Zoom - Ben Johnson" → "Zoom call with Ben Johnson".
- Keep "note" empty unless there's genuinely useful context visible (location, call link).
- If you can't read the image or there are no timed events, return an empty array: []`;

type WeekBlock = {
  day: string;
  events: Array<{ time: string; task: string; note: string }>;
};

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const DAY_ALIASES: Record<string, (typeof DAY_NAMES)[number]> = {
  mon: "Monday",
  monday: "Monday",
  tue: "Tuesday",
  tues: "Tuesday",
  tuesday: "Tuesday",
  wed: "Wednesday",
  weds: "Wednesday",
  wednesday: "Wednesday",
  thu: "Thursday",
  thur: "Thursday",
  thurs: "Thursday",
  thursday: "Thursday",
  fri: "Friday",
  friday: "Friday",
  sat: "Saturday",
  saturday: "Saturday",
  sun: "Sunday",
  sunday: "Sunday",
};

function normalizeTime(raw: string) {
  const cleaned = raw
    .replace(/[–—]/g, "-")
    .replace(/\./g, "")
    .trim();
  const range = cleaned.match(/(\d{1,2})(?::(\d{2}))?\s*([ap][a-z]*)?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*([ap][a-z]*)?/i);
  if (range) {
    let hour = Number(range[1]);
    const minutes = range[2] ?? "00";
    let suffix = normalizeMeridiem(range[3]) || normalizeMeridiem(range[6]);
    if (!suffix) suffix = hour >= 7 && hour < 12 ? "AM" : "PM";
    if (hour === 0) hour = 12;
    if (hour > 12) {
      suffix = "PM";
      hour -= 12;
    }
    return `${hour}:${minutes} ${suffix}`;
  }

  const first = cleaned.split(/\s*-\s*/)[0].trim();
  const match = first.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap][a-z]*)?$/i);
  if (!match) return "";
  let hour = Number(match[1]);
  const minutes = match[2] ?? "00";
  let suffix = normalizeMeridiem(match[3]);
  if (!suffix) suffix = hour >= 7 && hour < 12 ? "AM" : "PM";
  if (hour === 0) hour = 12;
  if (hour > 12) {
    suffix = "PM";
    hour -= 12;
  }
  return `${hour}:${minutes} ${suffix}`;
}

function normalizeMeridiem(raw?: string) {
  const cleaned = raw?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  if (!cleaned) return "";
  if (cleaned.startsWith("a")) return "AM";
  if (cleaned.startsWith("p")) return "PM";
  return "";
}

function timeToMinutes(raw: string) {
  const match = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  let hour = Number(match[1]);
  const minutes = Number(match[2]);
  const suffix = match[3].toUpperCase();
  if (suffix === "PM" && hour !== 12) hour += 12;
  if (suffix === "AM" && hour === 12) hour = 0;
  return hour * 60 + minutes;
}

function looksLikeBadTask(raw: string) {
  const value = raw.trim();
  const squashed = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const digitCount = squashed.replace(/[^0-9]/g, "").length;
  const letterCount = squashed.replace(/[^a-z]/g, "").length;
  if (!value) return true;
  if (/^\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p|ar|pr)?$/i.test(value)) return true;
  if (/^\d{1,2}(?::\d{2})?\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p|ar|pr)?$/i.test(value)) return true;
  if (/^(am|pm|a|p|ar|pr)$/i.test(value)) return true;
  if (/^\d{3,}(?:am|pm|a|p|ar|pr)?$/i.test(squashed)) return true;
  if (!/[a-z]/i.test(value)) return true;
  if (digitCount >= letterCount && letterCount <= 2) return true;
  if (value.length <= 3) return true;
  return false;
}

function cleanTask(raw: string) {
  let value = raw
    .replace(/^[•\-*]\s*/, "")
    // Strip common OCR leading artifacts: (, [, {, ', "
    .replace(/^['"""''({\[]+/, "")
    // Strip OCR artifact "'t" prefix (misread "Not" → "'t")
    .replace(/^'?t\s+/i, "")
    .replace(/^[,.;:)\]]+/, "")
    .replace(/[|]+/g, " ")
    // Strip trailing noise: +, ), ], punctuation
    .replace(/[+)\]}'"""'']+$/, "")
    .replace(/\s*[,;:]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  // Capitalize first letter if it was lowercased by stripping
  if (value.length > 0) value = value[0].toUpperCase() + value.slice(1);
  return value;
}

function weekQuality(week: WeekBlock[]) {
  const populatedDays = week.filter((block) => block.events.length).length;
  const allEvents = week.flatMap((block) => block.events);
  const badTasks = allEvents.filter((event) => looksLikeBadTask(event.task)).length;
  const repeatedTasks = new Map<string, number>();
  allEvents.forEach((event) => {
    const key = event.task.toLowerCase();
    repeatedTasks.set(key, (repeatedTasks.get(key) ?? 0) + 1);
  });
  const maxRepeats = Math.max(0, ...repeatedTasks.values());
  return {
    populatedDays,
    totalEvents: allEvents.length,
    badTaskRatio: allEvents.length ? badTasks / allEvents.length : 1,
    maxRepeats,
  };
}

function looksCollapsedOrLowQuality(week: WeekBlock[]) {
  const quality = weekQuality(week);
  const dayLoads = week.map((block) => block.events.length).sort((a, b) => b - a);
  const largestDay = dayLoads[0] ?? 0;
  if (!quality.totalEvents) return true;
  if (quality.badTaskRatio > 0.18) return true;
  if (quality.populatedDays === 1 && quality.totalEvents >= 5) return true;
  if (quality.populatedDays <= 2 && largestDay >= Math.max(5, Math.ceil(quality.totalEvents * 0.72))) return true;
  return false;
}

function candidateScore(week: WeekBlock[]) {
  const quality = weekQuality(week);
  return quality.totalEvents * 8 + quality.populatedDays * 16 - quality.badTaskRatio * 120;
}

function normalizeWeekBlocks(week: WeekBlock[]) {
  return week
    .map((block) => {
      const seen = new Set<string>();
      const events = block.events
        .map((event) => ({
          time: normalizeTime(event.time),
          task: cleanTask(event.task),
          note: cleanTask(event.note ?? ""),
        }))
        .filter((event) => event.time && !looksLikeBadTask(event.task))
        .filter((event) => {
          const key = `${event.time}|${event.task.toLowerCase()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

      return { day: block.day, events };
    })
    .filter((block) => block.events.length);
}

function stripTimeFragments(raw: string) {
  return raw
    .replace(/\b\d{1,2}(?::\d{2})?\s*[ap][a-z]*\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*[ap][a-z]*\b/gi, " ")
    .replace(/\b\d{1,2}(?::\d{2})?\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*[ap][a-z]*\b/gi, " ")
    .replace(/\b\d{1,2}(?::\d{2})?\s*[ap][a-z]*\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeObservationText(raw: string) {
  return raw
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeObservedDay(raw: string): (typeof DAY_NAMES)[number] | null {
  const letters = normalizeObservationText(raw).toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) return null;
  for (const [alias, day] of Object.entries(DAY_ALIASES)) {
    if (alias.length >= 3 && letters.startsWith(alias)) return day;
  }
  return null;
}

function parseEventFromObservationGroup(lines: VisionOcrObservation[]) {
  const normalizedLines = lines
    .map((line) => normalizeObservationText(line.text))
    .filter(Boolean);
  if (!normalizedLines.length) return null;

  let time = "";
  const taskParts: string[] = [];

  for (const line of normalizedLines) {
    const lineTime = normalizeTime(line);
    if (lineTime && !time) time = lineTime;
    const taskPart = cleanTask(stripTimeFragments(line));
    if (taskPart && !looksLikeBadTask(taskPart)) taskParts.push(taskPart);
  }

  if (!time) {
    time = normalizeTime(normalizedLines.join(" "));
  }

  const task = cleanTask(
    taskParts.filter((part, index) => taskParts.findIndex((value) => value.toLowerCase() === part.toLowerCase()) === index).join(" ")
  );

  if (!time || !task || looksLikeBadTask(task)) return null;
  return { time, task, note: "" };
}

function buildEventsFromVisionDayLines(lines: VisionOcrObservation[]) {
  const sorted = lines
    .filter((line) => normalizeObservationText(line.text).length > 1)
    .sort((a, b) => {
      if (Math.abs(a.midY - b.midY) > 0.012) return b.midY - a.midY;
      return a.minX - b.minX;
    });

  const groups: VisionOcrObservation[][] = [];

  for (const line of sorted) {
    const lastGroup = groups[groups.length - 1];
    if (!lastGroup) {
      groups.push([line]);
      continue;
    }

    const groupTop = Math.max(...lastGroup.map((item) => item.maxY));
    const groupBottom = Math.min(...lastGroup.map((item) => item.minY));
    const groupMidX = lastGroup.reduce((sum, item) => sum + item.midX, 0) / lastGroup.length;
    const groupMinX = Math.min(...lastGroup.map((item) => item.minX));
    const groupMaxX = Math.max(...lastGroup.map((item) => item.maxX));
    const verticalGap = groupBottom - line.maxY;
    const xOverlap = Math.min(groupMaxX, line.maxX) - Math.max(groupMinX, line.minX);
    const closeX = Math.abs(groupMidX - line.midX) < 0.075;
    const isSameCard = verticalGap <= 0.05 && line.midY <= groupTop && (xOverlap > -0.015 || closeX);

    if (isSameCard) lastGroup.push(line);
    else groups.push([line]);
  }

  return groups
    .map((group) => parseEventFromObservationGroup(group))
    .filter((event): event is { time: string; task: string; note: string } => Boolean(event));
}

function parseWeekFromColumnClusters(observations: VisionOcrObservation[]) {
  const weekdayOrder = DAY_NAMES.slice(0, 5);
  const candidates = observations
    .map((line) => ({ ...line, text: normalizeObservationText(line.text) }))
    .filter((line) => line.text && !normalizeObservedDay(line.text))
    .filter((line) => line.midY < 0.86)
    .filter((line) => !/^\d{1,2}$/.test(line.text))
    .sort((a, b) => a.midX - b.midX);

  if (candidates.length < 8) return [];

  const splitCandidates = candidates
    .slice(1)
    .map((line, index) => ({
      index,
      gap: line.midX - candidates[index].midX,
    }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 4)
    .sort((a, b) => a.index - b.index);

  if (splitCandidates.length < 4) return [];

  const groups: VisionOcrObservation[][] = [];
  let start = 0;
  for (const split of splitCandidates) {
    groups.push(candidates.slice(start, split.index + 1));
    start = split.index + 1;
  }
  groups.push(candidates.slice(start));

  if (groups.length !== 5) return [];

  const week = groups.map((group, index) => ({
    day: weekdayOrder[index],
    events: buildEventsFromVisionDayLines(group),
  }));

  return normalizeWeekBlocks(week);
}

function parseWeekFromVisionObservations(observations: VisionOcrObservation[]) {
  const weekdayOrder = DAY_NAMES.slice(0, 5);
  const dayHeaders = observations
    .map((line) => ({ ...line, text: normalizeObservationText(line.text), day: normalizeObservedDay(line.text) }))
    .filter((line): line is VisionOcrObservation & { text: string; day: (typeof DAY_NAMES)[number] } => Boolean(line.day))
    .filter((line) => weekdayOrder.includes(line.day) && line.midY > 0.82)
    .sort((a, b) => a.midX - b.midX);

  const bestHeaderByDay = new Map<(typeof DAY_NAMES)[number], VisionOcrObservation & { text: string; day: (typeof DAY_NAMES)[number] }>();
  for (const header of dayHeaders) {
    const existing = bestHeaderByDay.get(header.day);
    if (!existing || header.midY > existing.midY) bestHeaderByDay.set(header.day, header);
  }

  const presentHeaders = weekdayOrder
    .map((day) => bestHeaderByDay.get(day))
    .filter((header): header is VisionOcrObservation & { text: string; day: (typeof DAY_NAMES)[number] } => Boolean(header))
    .sort((a, b) => a.midX - b.midX);

  if (presentHeaders.length < 3) return [];

  const spacing =
    presentHeaders.length > 1
      ? presentHeaders
          .slice(1)
          .reduce((sum, header, index) => sum + (header.midX - presentHeaders[index].midX), 0) /
        (presentHeaders.length - 1)
      : 0.19;

  const inferredCenters = weekdayOrder.map((day, index) => {
    const existing = bestHeaderByDay.get(day);
    if (existing) return existing.midX;
    let previousIndex = -1;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (bestHeaderByDay.has(weekdayOrder[i])) {
        previousIndex = i;
        break;
      }
    }
    if (previousIndex >= 0) {
      const previousDay = weekdayOrder[previousIndex];
      return (bestHeaderByDay.get(previousDay)?.midX ?? 0.1) + (index - previousIndex) * spacing;
    }
    let nextIndex = -1;
    for (let i = index + 1; i < weekdayOrder.length; i += 1) {
      if (bestHeaderByDay.has(weekdayOrder[i])) {
        nextIndex = i;
        break;
      }
    }
    if (nextIndex >= 0) {
      const nextDay = weekdayOrder[nextIndex];
      return (bestHeaderByDay.get(nextDay)?.midX ?? 0.9) - (nextIndex - index) * spacing;
    }
    return 0.1 + index * spacing;
  });

  const columns = weekdayOrder.map((day, index) => ({
    day,
    center: inferredCenters[index],
    left: index === 0 ? 0 : (inferredCenters[index - 1] + inferredCenters[index]) / 2,
    right: index === weekdayOrder.length - 1 ? 1 : (inferredCenters[index] + inferredCenters[index + 1]) / 2,
  }));

  const contentTop = Math.min(...presentHeaders.map((header) => header.minY)) - 0.02;
  const byDay = new Map<string, VisionOcrObservation[]>();
  weekdayOrder.forEach((day) => byDay.set(day, []));

  for (const line of observations) {
    const text = normalizeObservationText(line.text);
    if (!text || line.maxY >= contentTop) continue;
    if (/^\d{1,2}$/.test(text)) continue;
    if (normalizeObservedDay(text)) continue;
    const column = columns.find((item) => line.midX >= item.left && line.midX < item.right);
    if (!column) continue;
    byDay.get(column.day)?.push({ ...line, text } as VisionOcrObservation);
  }

  const week: WeekBlock[] = [];

  for (const day of weekdayOrder) {
    const events = buildEventsFromVisionDayLines(byDay.get(day) ?? []);

    if (events.length) week.push({ day, events });
  }

  return normalizeWeekBlocks(week);
}

function pickBestWeek(...candidates: WeekBlock[][]) {
  const normalizedCandidates = candidates
    .map((candidate) => normalizeWeekBlocks(candidate))
    .filter((candidate) => candidate.length);

  if (!normalizedCandidates.length) return [];

  const viable = normalizedCandidates.filter((candidate) => !looksCollapsedOrLowQuality(candidate));
  const source = viable.length ? viable : normalizedCandidates;
  return [...source].sort((a, b) => candidateScore(b) - candidateScore(a))[0] ?? [];
}

function parseWeekTextToBlocks(source: string): WeekBlock[] {
  const blocks = new Map<string, WeekBlock>();
  let currentDay: (typeof DAY_NAMES)[number] | null = null;

  const ensureDay = (day: (typeof DAY_NAMES)[number]) => {
    if (!blocks.has(day)) blocks.set(day, { day, events: [] });
    return blocks.get(day)!;
  };

  const lines = source
    .split("\n")
    .map((line) => line.replace(/\t/g, " ").trim())
    .filter(Boolean);

  for (const line of lines) {
    const dayOnly = line.match(/^(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday|s)?|thu(?:r|rs|rsday|ursday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)[:\s-]*$/i);
    if (dayOnly) {
      currentDay = DAY_ALIASES[dayOnly[1].toLowerCase()];
      ensureDay(currentDay);
      continue;
    }

    const dayAndEvent = line.match(/^(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday|s)?|thu(?:r|rs|rsday|ursday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)[:,\s-]+(.+)$/i);
    let working = line;
    if (dayAndEvent) {
      currentDay = DAY_ALIASES[dayAndEvent[1].toLowerCase()];
      working = dayAndEvent[2].trim();
      ensureDay(currentDay);
    }

    if (!currentDay) continue;

    const eventMatch = working.match(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)\s+(.+)$/i);
    if (!eventMatch) continue;
    const time = normalizeTime(eventMatch[1]);
    const task = eventMatch[2].replace(/^[•\-*]\s*/, "").trim();
    if (!time || !task) continue;
    ensureDay(currentDay).events.push({ time, task, note: "" });
  }

  return DAY_NAMES
    .map((day) => blocks.get(day))
    .filter((block): block is WeekBlock => Boolean(block && block.events.length));
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const textInput = String(formData.get("text") ?? "").trim();
  if (textInput) {
    return NextResponse.json({ week: normalizeWeekBlocks(parseWeekTextToBlocks(textInput)) });
  }

  const file = formData.get("image") as File | null;
  if (!file) return NextResponse.json({ week: [] });

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const mediaType = (file.type || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

  try {
    const visionObservations = file.type === "application/pdf" ? [] : await localVisionObservationsFromUpload(file);
    const visionWeek = pickBestWeek(
      parseWeekFromVisionObservations(visionObservations),
      parseWeekFromColumnClusters(visionObservations),
    );
    const ocrText = await localOcrFromUpload(file);
    const ocrWeek = ocrText ? normalizeWeekBlocks(parseWeekTextToBlocks(ocrText)) : [];

    const useOllama = process.env.USE_OLLAMA === "true" || !process.env.ANTHROPIC_API_KEY;
    if (useOllama) {
      const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
      const model = process.env.OLLAMA_MODEL ?? "llama3.2-vision";
      const res = await fetch(`${ollamaUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
                { type: "text", text: "Extract all timed calendar events from this weekly calendar, grouped by the correct day column. Never dump events from multiple days under Friday or any other single day. For recurring events like meditation or deep work, create one event under each day where it appears. The task field must be the event title only, never an end time." },
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
      const data = await res.json();
      const text = data.choices[0].message.content?.trim() ?? "[]";
      const modelWeek = normalizeWeekBlocks(JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? "[]"));
      const week = pickBestWeek(visionWeek, modelWeek, ocrWeek);
      return NextResponse.json({ week: looksCollapsedOrLowQuality(week) ? [] : week, rawText: ocrText });
    }

    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            { type: "text", text: "Extract all timed calendar events from this weekly calendar, grouped by day." },
          ],
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "[]";
    const modelWeek = normalizeWeekBlocks(JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? "[]"));
    const week = pickBestWeek(visionWeek, modelWeek, ocrWeek);
    return NextResponse.json({ week: looksCollapsedOrLowQuality(week) ? [] : week, rawText: ocrText });
  } catch (e) {
    console.error("parse-week-calendar error", e);
    const message = e instanceof Error ? e.message : "Couldn't read the calendar";
    return NextResponse.json({ week: [], error: message }, { status: 500 });
  }
}
