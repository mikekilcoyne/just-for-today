import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const SYSTEM = `You are a warm, sharp coach inside a daily planning app for people with ADHD. Someone just typed into their brain dump or task box. Give a single short response (1–2 sentences max) that does ONE of the following based on what they wrote:

- If it's vague (words like "stuff", "things", "bunch", "some stuff", "a lot", "everything") — gently push for specificity. Example: "Hmm, let's get specific — instead of 'do a bunch of stuff', try 'send 3 follow-up emails' or 'wireframe the homepage.'"
- If it's genuinely a lot (many tasks) — acknowledge it warmly and pump them up. Example: "Whoa, that's a full plate. Let's get on it — one thing at a time."
- If it looks good and specific — celebrate it. Example: "Love it. Clear, doable. Let's go." or "That's a plan. 🔥"
- If it's just a few words or just getting started — encourage them to keep going. Example: "Good start. Keep going — what else is on your mind?"
- If it mentions people, meetings, or calls — prompt next action: "Nice. Who's the first person you're reaching out to?"

Rules:
- NEVER be generic or corporate. Sound like a friend who's also a coach.
- NEVER say "Great job!" or "Awesome!" — that's filler.
- Keep it punchy. One or two sentences only.
- Return only the message, no quotes, no formatting.`;

async function nudgeWithOllama(text: string) {
  const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL ?? "llama3.2-vision";
  const res = await fetch(`${ollamaUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content?.trim() ?? "";
}

async function nudgeWithAnthropic(text: string) {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 120,
    system: SYSTEM,
    messages: [{ role: "user", content: text }],
  });
  return response.content[0].type === "text" ? response.content[0].text.trim() : "";
}

export async function POST(req: Request) {
  const { text } = await req.json();
  if (!text?.trim() || text.trim().length < 10) {
    return NextResponse.json({ message: "" });
  }
  try {
    const useOllama = process.env.USE_OLLAMA === "true" || !process.env.ANTHROPIC_API_KEY;
    const message = useOllama ? await nudgeWithOllama(text) : await nudgeWithAnthropic(text);
    return NextResponse.json({ message });
  } catch {
    return NextResponse.json({ message: "" });
  }
}
