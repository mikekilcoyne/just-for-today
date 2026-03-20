import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const SYSTEM = `You are a sharp, practical assistant helping someone plan their day from a brain dump.

You will receive the brain dump and the current time of day. Use the current time to anchor the schedule realistically.

Extract and return JSON with these fields:

- topPriority: The single most important thing to move forward today. One clear sentence.
- secondaryMoves: Other meaningful tasks. Brief, comma-separated.
- niceToHaves: Optional low-stakes tasks if time and energy allow.
- projectPlan: If the brain dump mentions a project, landing page, design task, or deliverable — write a short, clear action plan (3-6 bullet points starting with •). Otherwise return "".
- schedule: Array of time blocks for the day, starting from current time. Each block: { "time": "10:00 – 11:30", "task": "what they're doing", "note": "any helpful context, draft, or reminder — or empty string" }. Create 4-7 blocks. Use context clues for timing. Be realistic about durations. Include buffer and breaks naturally. If an email or text was mentioned, put a short version in the note for that block.
- texts: Array of people mentioned who need a text. For each: { "to": name/handle, "draft": a short, natural, ready-to-send text message they can copy-paste }.
- emails: Array of people or organizations needing an email. For each: { "to": name or email, "subject": clear subject line, "draft": full email body, professional but human }.
- interviewGameplan: If the brain dump mentions interviews (scheduling them, conducting them, prep, candidates, Breakfast Club, etc.) — write a focused gameplan (4-8 bullet points starting with •). Cover: who to interview, what to ask, logistics, follow-up. Otherwise return "".

Rules:
- Only extract what's actually in the brain dump. Don't invent.
- texts and emails arrays can be empty [] if none are mentioned.
- Draft messages should feel personal and ready to send, not robotic.
- projectPlan should be specific and actionable, not generic advice.
- schedule should feel like a real plan a thoughtful person would make, not a generic template.`;

const SCHEMA = {
  type: "object" as const,
  properties: {
    topPriority: { type: "string" as const },
    secondaryMoves: { type: "string" as const },
    niceToHaves: { type: "string" as const },
    projectPlan: { type: "string" as const },
    schedule: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          time: { type: "string" as const },
          task: { type: "string" as const },
          note: { type: "string" as const },
        },
        required: ["time", "task", "note"],
        additionalProperties: false,
      },
    },
    texts: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          to: { type: "string" as const },
          draft: { type: "string" as const },
        },
        required: ["to", "draft"],
        additionalProperties: false,
      },
    },
    emails: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          to: { type: "string" as const },
          subject: { type: "string" as const },
          draft: { type: "string" as const },
        },
        required: ["to", "subject", "draft"],
        additionalProperties: false,
      },
    },
    interviewGameplan: { type: "string" as const },
  },
  required: ["topPriority", "secondaryMoves", "niceToHaves", "projectPlan", "schedule", "texts", "emails", "interviewGameplan"],
  additionalProperties: false,
};

async function parseWithOllama(brainDump: string, currentTime: string) {
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
        { role: "user", content: `Current time: ${currentTime}\n\n${brainDump}` },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function parseWithAnthropic(brainDump: string, currentTime: string) {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: "user", content: `Current time: ${currentTime}\n\n${brainDump}` }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "{}";
  return JSON.parse(text);
}

export async function POST(req: Request) {
  const { brainDump, currentTime = "9:00 AM" } = await req.json();

  if (!brainDump?.trim()) {
    return NextResponse.json({ error: "Nothing to parse" }, { status: 400 });
  }

  const useOllama =
    process.env.USE_OLLAMA === "true" || !process.env.ANTHROPIC_API_KEY;

  const result = useOllama
    ? await parseWithOllama(brainDump, currentTime)
    : await parseWithAnthropic(brainDump, currentTime);

  return NextResponse.json(result);
}
