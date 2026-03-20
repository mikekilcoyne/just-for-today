import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const SYSTEM = `You are a sharp assistant helping someone draft a professional but human email.

Given: who it's to, a subject, and rough notes — write a complete, ready-to-send email body.

Rules:
- Warm but direct. Not robotic or overly formal.
- Match the tone to the context (legal/attorney = professional; friend/colleague = casual)
- Keep it concise. No fluff.
- Do NOT include a subject line in the body.
- Do NOT include "Subject:" in your response.
- Return ONLY the email body text, nothing else. No quotes, no preamble.`;

async function draftWithOllama(to: string, subject: string, notes: string) {
  const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL ?? "llama3.2-vision";
  const res = await fetch(`${ollamaUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `To: ${to}\nSubject: ${subject}\nNotes: ${notes}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content?.trim() ?? "";
}

async function draftWithAnthropic(to: string, subject: string, notes: string) {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 600,
    system: SYSTEM,
    messages: [{ role: "user", content: `To: ${to}\nSubject: ${subject}\nNotes: ${notes}` }],
  });
  return response.content[0].type === "text" ? response.content[0].text.trim() : "";
}

export async function POST(req: Request) {
  const { to, subject, notes } = await req.json();
  if (!notes?.trim()) {
    return NextResponse.json({ error: "No notes provided" }, { status: 400 });
  }
  try {
    const useOllama = process.env.USE_OLLAMA === "true" || !process.env.ANTHROPIC_API_KEY;
    const draft = useOllama
      ? await draftWithOllama(to ?? "", subject ?? "", notes)
      : await draftWithAnthropic(to ?? "", subject ?? "", notes);
    return NextResponse.json({ draft });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
