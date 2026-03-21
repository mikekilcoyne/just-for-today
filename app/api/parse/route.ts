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
  return JSON.parse(data.choices[0].message.content);
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
  // Extract JSON from response (model may wrap it in ```json ... ```)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  return JSON.parse(jsonMatch ? jsonMatch[1] : text);
}

export async function POST(req: Request) {
  const { brainDump, currentTime = "9:00 AM", fixedEvents = [] } = await req.json();

  if (!brainDump?.trim()) {
    return NextResponse.json({ error: "Nothing to parse" }, { status: 400 });
  }

  const useOllama =
    process.env.USE_OLLAMA === "true" || !process.env.ANTHROPIC_API_KEY;

  const result = useOllama
    ? await parseWithOllama(brainDump, currentTime, fixedEvents)
    : await parseWithAnthropic(brainDump, currentTime, fixedEvents);

  return NextResponse.json(normalizeParseResult(result));
}
