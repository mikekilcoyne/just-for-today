import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const SYSTEM = `You are helping someone prepare for interviews. Based on the context, generate focused interview questions.

If multiple people are mentioned, group questions by person. If only one person or a general context, use a single group with name "General".

Return JSON:
{
  "interviewees": [
    { "name": "Person Name or General", "questions": ["question 1", "question 2", ...] }
  ]
}

Guidelines:
- 6–10 questions per person
- Questions should be specific to each person's context, not generic
- Mix: 1-2 warm-up/background, 3-4 core situational/experience, 1-2 forward-looking, 1 closing
- Open-ended, conversational, thought-provoking
- Each question should stand alone on its own page when printed`;

const SCHEMA = {
  type: "object" as const,
  properties: {
    interviewees: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          name: { type: "string" as const },
          questions: { type: "array" as const, items: { type: "string" as const } },
        },
        required: ["name", "questions"],
        additionalProperties: false,
      },
    },
  },
  required: ["interviewees"],
  additionalProperties: false,
};

async function generateWithOllama(context: string) {
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
        { role: "user", content: context },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function generateWithAnthropic(context: string) {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: "user", content: context }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });
  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  return JSON.parse(text);
}

export async function POST(req: Request) {
  const { context } = await req.json();
  if (!context?.trim()) {
    return NextResponse.json({ error: "No context provided" }, { status: 400 });
  }

  const useOllama = process.env.USE_OLLAMA === "true" || !process.env.ANTHROPIC_API_KEY;
  const result = useOllama
    ? await generateWithOllama(context)
    : await generateWithAnthropic(context);

  return NextResponse.json(result);
}
