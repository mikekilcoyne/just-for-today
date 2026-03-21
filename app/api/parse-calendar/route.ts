import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const SYSTEM = `You are extracting calendar events from a screenshot or photo of a calendar app.

Return ONLY a valid JSON array of time blocks. No explanation, no markdown, just the raw array.

Format:
[
  { "time": "9:00 AM", "task": "Zoom call with Ben", "note": "" },
  { "time": "12:30 PM", "task": "Meet with Andrea", "note": "" }
]

Rules:
- The "time" field is the START TIME ONLY. Never write a range like "11:00 - 12:30". If an event runs 11:00–12:30, write "11:00 AM". Just the start.
- Use 12-hour time format with AM/PM for every time (e.g. "9:00 AM", "12:30 PM", "3:00 PM").
- Only include events with a specific time. Skip all-day events.
- Task names must be specific and readable. "Zoom - Ben Johnson" → "Zoom call with Ben Johnson". "Lunch w/ Andrea" → "Lunch with Andrea".
- Keep "note" empty unless there's genuinely useful context visible (location, call link).
- If you can't read the image or there are no timed events, return an empty array: []`;

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("image") as File | null;
  if (!file) return NextResponse.json({ schedule: [] });

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const mediaType = (file.type || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

  try {
    const useOllama = process.env.USE_OLLAMA === "true" || !process.env.ANTHROPIC_API_KEY;
    if (useOllama) {
      // Ollama vision fallback
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
                { type: "text", text: "Extract all timed calendar events from this image." },
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
      const data = await res.json();
      const text = data.choices[0].message.content?.trim() ?? "[]";
      const schedule = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
      return NextResponse.json({ schedule });
    }

    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            { type: "text", text: "Extract all timed calendar events from this image." },
          ],
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "[]";
    const schedule = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
    return NextResponse.json({ schedule });
  } catch (e) {
    console.error("parse-calendar error", e);
    return NextResponse.json({ schedule: [] });
  }
}
