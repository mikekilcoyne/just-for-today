import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const SYSTEM = `You are a prompt engineer helping someone get the most out of AI tools like Claude.

Given a rough brief of what someone needs to build or create, write a clear, detailed, ready-to-use AI prompt.

Rules:
- Write in second person ("You are a..." / "Please..." / "Create a...")
- Include all the context from the brief
- Be specific about the desired output format, tone, and scope
- Add any obvious constraints or success criteria you can infer
- Keep it under 200 words
- Return ONLY the prompt text — no preamble, no explanation, no quotes`;

async function generateWithOllama(brief: string) {
  const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL ?? "llama3.2-vision";
  const res = await fetch(`${ollamaUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Brief: ${brief}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content?.trim() ?? "";
}

async function generateWithAnthropic(brief: string) {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: "user", content: `Brief: ${brief}` }],
  });
  return response.content[0].type === "text" ? response.content[0].text.trim() : "";
}

export async function POST(req: Request) {
  const { brief } = await req.json();
  if (!brief?.trim()) {
    return NextResponse.json({ error: "No brief provided" }, { status: 400 });
  }
  try {
    const useOllama = process.env.USE_OLLAMA === "true" || !process.env.ANTHROPIC_API_KEY;
    const prompt = useOllama
      ? await generateWithOllama(brief)
      : await generateWithAnthropic(brief);
    return NextResponse.json({ prompt });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
