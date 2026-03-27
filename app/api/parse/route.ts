import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const SYSTEM = `You are a sharp, practical assistant helping someone plan their day from a brain dump.

You will receive: the brain dump, the current time, and optionally a list of fixed calendar events already on their day.

Return JSON with these fields:

- topPriority: The single most important, specific thing to move forward today. One crisp sentence. Max 60 characters.
- secondaryMoves: Other meaningful tasks. One item per line, newline-separated, no bullets, no commas. Use real names and specific actions from the brain dump.
- niceToHaves: Low-stakes optional tasks if time allows. One item per line, newline-separated. Only things actually mentioned.
- projectPlan: If a project, app, deliverable, or design task is mentioned, write 3-6 specific next-action steps starting with bullet (•). Rules:
  • Use the actual project name from the brain dump (e.g. "Breakfast Club landing page", not just "the project").
  • Steps must be sequenced for TODAY — ordered so the first step can start right now and each one builds on the last.
  • If a relevant time block is already in the schedule (e.g. "2pm — work on landing page"), anchor a step to that slot: "At 2pm: finalize hero copy for Breakfast Club landing page".
  • Steps must match the scope of the day — not a full project roadmap. Only what can realistically happen today.
  • Do NOT repeat anything already listed in topPriority or secondaryMoves verbatim — the steps should add specificity and sequence, not duplicate.
  • If no project/deliverable is mentioned, return "".
- schedule: Array of time blocks. Each block: { "time": "10:00 AM", "task": "specific description", "note": "" }

  SCHEDULE RULES — READ CAREFULLY:
  1. The "time" field is a START TIME ONLY. NEVER write a range like "11:00 - 12:30". Always a single time: "11:00 AM", "12:30 PM", "3:00 PM".
  2. If the user mentions a specific time (e.g. "12:30 Zoom with Ben", "3pm call with Ruth"), use that EXACT time. Do not shift it or treat it as an end time.
  3. If fixed calendar events are provided, include them EXACTLY — same name, same time. Do not rename or duplicate them.
  4. Only include blocks for things the user actually mentioned. Do NOT invent prep blocks, buffer time, travel time, or "wrap up" blocks unless the user said so.
  5. Do NOT add the same event twice. Each task should appear once only.
  6. Task names must be specific: "Zoom call with Ben" not "Call". Use the actual name/project from the brain dump.
  7. Return blocks in CHRONOLOGICAL ORDER, earliest time first.
  8. 4-8 blocks total. Use 12-hour time with AM/PM throughout.
  9. Leave "note" empty unless there is a genuinely useful reminder the user mentioned.

- texts: People needing a text. { "to": real name, "draft": short casual ready-to-send message }. Only if mentioned.
- emails: People needing an email. { "to": name/email, "subject": clear subject, "draft": full human email body }. Only if mentioned.
- interviewGameplan: If interviews are mentioned, write a 4-8 bullet gameplan starting with •. Otherwise "".

Hard rules:
- Use EXACT names from the brain dump. Never say "someone" or "them" when a name was given.
- secondaryMoves and niceToHaves MUST be newline-separated. Never comma-separated.
- Do not invent tasks, people, or events.
- NEVER use a time range in the time field. Start times only.`;

function buildUserMessage(brainDump: string, currentTime: string, fixedEvents: { time: string; task: string; note: string }[]) {
  let msg = `Current time: ${currentTime}\n\n`;
  if (fixedEvents.length > 0) {
    msg += `Fixed calendar events (already scheduled — include these exactly as-is in the schedule):\n`;
    fixedEvents.forEach(e => { msg += `• ${e.time} — ${e.task}${e.note ? ` (${e.note})` : ""}\n`; });
    msg += "\n";
  }
  msg += `Brain dump:\n${brainDump}`;
  return msg;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function extractActionLines(brainDump: string) {
  return brainDump
    .split("\n")
    .map((line) => line.replace(/^[•\-*\d.)\s]+/, "").trim())
    .filter((line) => line.length > 2);
}

function parseClockToMinutes(value: string) {
  const match = value.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "PM" && hours !== 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  if (!meridiem && hours < 7) hours += 12;
  return hours * 60 + minutes;
}

function formatMinutesAsTime(totalMinutes: number) {
  const dayMinutes = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours24 = Math.floor(dayMinutes / 60);
  const minutes = dayMinutes % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function buildRoughSchedule(brainDump: string, currentTime: string, fixedEvents: { time: string; task: string; note: string }[]) {
  const fixedTaskKeys = new Set(fixedEvents.map((event) => event.task.trim().toLowerCase()));
  const actionLines = Array.from(new Set(extractActionLines(brainDump)))
    .filter((line) => !fixedTaskKeys.has(line.toLowerCase()))
    .slice(0, 5);

  if (!actionLines.length) return fixedEvents;

  const occupiedMinutes = fixedEvents
    .map((event) => parseClockToMinutes(event.time))
    .filter((value): value is number => value !== null);
  const roundedNow = (() => {
    const parsed = parseClockToMinutes(currentTime);
    if (parsed === null) return 9 * 60;
    const rounded = Math.ceil(parsed / 30) * 30;
    return Math.max(rounded, 8 * 60 + 30);
  })();

  let cursor = roundedNow;
  const generated = actionLines.map((task, index) => {
    if (index > 0) cursor += 90;
    while (occupiedMinutes.some((minute) => Math.abs(minute - cursor) < 50)) {
      cursor += 30;
    }
    occupiedMinutes.push(cursor);
    return {
      time: formatMinutesAsTime(cursor),
      task,
      note: "",
    };
  });

  return [...fixedEvents, ...generated].sort((a, b) => {
    const aMinutes = parseClockToMinutes(a.time) ?? 0;
    const bMinutes = parseClockToMinutes(b.time) ?? 0;
    return aMinutes - bMinutes;
  });
}

function buildFallbackPlan(brainDump: string, currentTime: string, fixedEvents: { time: string; task: string; note: string }[]) {
  const lines = Array.from(new Set(extractActionLines(brainDump)));
  const topPriority = lines[0] ?? "";
  const secondaryMoves = lines.slice(1, 4).join("\n");
  const niceToHaves = lines.slice(4, 7).join("\n");
  const projectCandidate = lines.find((line) => /\b(build|update|launch|plan|site|page|deck|proposal|prep|write|design)\b/i.test(line)) ?? "";

  return {
    topPriority,
    secondaryMoves,
    niceToHaves,
    projectPlan: projectCandidate
      ? [
          `• Start with: ${projectCandidate}`,
          ...lines
            .filter((line) => line !== topPriority && line !== projectCandidate)
            .slice(0, 2)
            .map((line) => `• Then: ${line}`),
        ].join("\n")
      : "",
    schedule: buildRoughSchedule(brainDump, currentTime, fixedEvents),
    texts: [],
    emails: [],
    interviewGameplan: "",
  };
}

function parseModelJson(text: string) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonMatch = trimmed.match(/```json\s*([\s\S]*?)```/) || trimmed.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) throw new Error("Model did not return JSON");
    return JSON.parse(jsonMatch[1]);
  }
}

function normalizeArray<T>(value: unknown, mapItem: (item: unknown) => T | null) {
  if (Array.isArray(value)) return value.map(mapItem).filter((item): item is T => item !== null);
  const single = mapItem(value);
  return single ? [single] : [];
}

function normalizeParseResult(result: unknown) {
  const source = result && typeof result === "object" ? result as Record<string, unknown> : {};
  return {
    topPriority: asString(source.topPriority),
    secondaryMoves: asString(source.secondaryMoves),
    niceToHaves: asString(source.niceToHaves),
    projectPlan: asString(source.projectPlan),
    schedule: normalizeArray(source.schedule, (item) => {
      if (!item || typeof item !== "object") return null;
      const block = item as { time?: unknown; task?: unknown; note?: unknown };
      if (typeof block.time !== "string" || typeof block.task !== "string") return null;
      return {
        time: block.time,
        task: block.task,
        note: typeof block.note === "string" ? block.note : "",
      };
    }),
    texts: normalizeArray(source.texts, (item) => {
      if (!item || typeof item !== "object") return null;
      const text = item as { to?: unknown; draft?: unknown };
      if (typeof text.to !== "string" || typeof text.draft !== "string") return null;
      return { to: text.to, draft: text.draft };
    }),
    emails: normalizeArray(source.emails, (item) => {
      if (!item || typeof item !== "object") return null;
      const email = item as { to?: unknown; subject?: unknown; draft?: unknown };
      if (typeof email.to !== "string" || typeof email.subject !== "string" || typeof email.draft !== "string") return null;
      return { to: email.to, subject: email.subject, draft: email.draft };
    }),
    interviewGameplan: asString(source.interviewGameplan),
  };
}

async function parseWithOllama(brainDump: string, currentTime: string, fixedEvents: { time: string; task: string; note: string }[]) {
  const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL ?? "llama3.2-vision";

  const res = await fetch(`${ollamaUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: buildUserMessage(brainDump, currentTime, fixedEvents) },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return parseModelJson(data.choices[0].message.content ?? "{}");
}

async function parseWithAnthropic(brainDump: string, currentTime: string, fixedEvents: { time: string; task: string; note: string }[]) {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 2500,
    system: SYSTEM,
    messages: [{ role: "user", content: buildUserMessage(brainDump, currentTime, fixedEvents) }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  return parseModelJson(text);
}

export async function POST(req: Request) {
  const { brainDump, currentTime = "9:00 AM", fixedEvents = [] } = await req.json();

  if (!brainDump?.trim()) {
    return NextResponse.json({ error: "Nothing to parse" }, { status: 400 });
  }

  const useOllama =
    process.env.USE_OLLAMA === "true" || !process.env.ANTHROPIC_API_KEY;

  try {
    const result = useOllama
      ? await parseWithOllama(brainDump, currentTime, fixedEvents)
      : await parseWithAnthropic(brainDump, currentTime, fixedEvents);
    const normalized = normalizeParseResult(result);
    const roughSchedule = buildRoughSchedule(brainDump, currentTime, fixedEvents);
    const fixedTaskKeys = new Set(
      fixedEvents.map((event: { time: string; task: string; note: string }) => event.task.trim().toLowerCase())
    );
    const hasPlannedWorkBlocks = normalized.schedule.some((block) => !fixedTaskKeys.has(block.task.trim().toLowerCase()));

    return NextResponse.json({
      ...normalized,
      schedule: hasPlannedWorkBlocks || roughSchedule.length === 0 ? normalized.schedule : roughSchedule,
    });
  } catch (error) {
    console.error("parse route fallback", error);
    return NextResponse.json(normalizeParseResult(buildFallbackPlan(brainDump, currentTime, fixedEvents)));
  }
}
