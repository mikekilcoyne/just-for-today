import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const SYSTEM = `You are the warm, grounding voice inside a daily planning app called "Just for Today." Each morning you write a tiny recap of the person's previous day — 1–2 sentences, max. It should feel like a friend catching you up on yourself: warm, specific, and forward-leaning. Not a performance review.

Rules:
- Pull from what actually happened: what they got done, what moved forward, how it felt.
- If they hit their top priority, name it specifically and celebrate it briefly.
- If the day was rough or they didn't finish, acknowledge it gently and look ahead.
- End with a sentence that leans into today with quiet energy — not hype, just presence.
- Never say "Great job" or "You crushed it" or anything hollow.
- No bullet points. No lists. Just a sentence or two.
- Return only the message, no quotes, no labels, no formatting.`;

async function recapWithAnthropic(payload: string) {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 120,
    system: SYSTEM,
    messages: [{ role: "user", content: payload }],
  });
  return response.content[0].type === "text" ? response.content[0].text.trim() : "";
}

async function recapWithOllama(payload: string) {
  const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL ?? "llama3.2-vision";
  const res = await fetch(`${ollamaUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: payload },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content?.trim() ?? "";
}

export async function POST(req: Request) {
  const body = await req.json();
  // Build a compact context string from whatever yesterday data exists
  const parts: string[] = [];
  if (body.topPriority)    parts.push(`Top priority: ${body.topPriority}`);
  if (body.movedForward)   parts.push(`What moved forward: ${body.movedForward}`);
  if (body.howItFelt)      parts.push(`How it felt: ${body.howItFelt}`);
  if (body.tomorrowBriefing) {
    const tb = body.tomorrowBriefing;
    if (tb.completed?.length) parts.push(`Completed: ${tb.completed.join(", ")}`);
    if (tb.open?.length)      parts.push(`Still open: ${tb.open.join(", ")}`);
    if (tb.movedForward)      parts.push(`Moved forward: ${tb.movedForward}`);
    if (tb.howItFelt)         parts.push(`How it felt: ${tb.howItFelt}`);
  }

  if (!parts.length) return NextResponse.json({ recap: "" });

  const payload = `Here's what happened yesterday:\n${parts.join("\n")}`;

  try {
    const useOllama = process.env.USE_OLLAMA === "true" || !process.env.ANTHROPIC_API_KEY;
    const recap = useOllama
      ? await recapWithOllama(payload)
      : await recapWithAnthropic(payload);
    return NextResponse.json({ recap });
  } catch {
    return NextResponse.json({ recap: "" });
  }
}
