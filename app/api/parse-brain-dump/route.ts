import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { localOcrFromUpload } from "../_lib/local-ocr";

const SYSTEM = `You are transcribing handwritten or typed notes from a photo, scan, or document page.

Always do your best, even if the handwriting is messy or the photo is imperfect. Guess at unclear words based on context — it's better to have a rough transcription than nothing.

Transcribe the content faithfully, preserving structure:
- Bullet points → use "- " prefix
- Numbered lists → keep numbering
- Headings or underlined titles → put on their own line in ALL CAPS
- Separate distinct thoughts with a blank line
- Crossed-out text → skip it
- If a word is genuinely illegible, write [illegible] in its place

Return ONLY the transcribed text. No commentary, no preamble, no explanation.`;

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ text: "" });

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const isPdf = file.type === "application/pdf";
  const mediaType = isPdf ? "application/pdf" : (file.type || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

  try {
    const useOllama = process.env.USE_OLLAMA === "true" || !process.env.ANTHROPIC_API_KEY;
    const localText = await localOcrFromUpload(file);
    if (useOllama) {
      if (localText) return NextResponse.json({ text: localText });
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
                { type: "text", text: "Transcribe all visible text from this image." },
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
      const data = await res.json();
      const text = data.choices[0].message.content?.trim() ?? "";
      return NextResponse.json({ text: text || localText });
    }

    const client = new Anthropic();

    const contentBlock = isPdf
      ? {
          type: "document" as const,
          source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 },
        }
      : {
          type: "image" as const,
          source: { type: "base64" as const, media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 },
        };

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            contentBlock,
            { type: "text", text: "Transcribe all visible text from this page." },
          ],
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    return NextResponse.json({ text: text || localText });
  } catch (e) {
    console.error("parse-brain-dump error", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ text: "", error: message }, { status: 500 });
  }
}
