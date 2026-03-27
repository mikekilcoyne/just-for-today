import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type VisionOcrObservation = {
  text: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  midX: number;
  midY: number;
  width: number;
  height: number;
};

function sanitizeOcrText(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function runTesseract(inputPath: string) {
  const { stdout } = await execFileAsync(
    "tesseract",
    [inputPath, "stdout", "--psm", "6", "-l", "eng"],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  return sanitizeOcrText(stdout);
}

async function runVisionOcr(inputPath: string) {
  const scriptPath = join(process.cwd(), "app/api/_lib/vision-ocr.swift");
  const { stdout } = await execFileAsync(
    "swift",
    [scriptPath, inputPath],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  return sanitizeOcrText(stdout);
}

async function runVisionOcrJson(inputPath: string) {
  const scriptPath = join(process.cwd(), "app/api/_lib/vision-ocr.swift");
  const { stdout } = await execFileAsync(
    "swift",
    [scriptPath, inputPath, "--json"],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as VisionOcrObservation[];
}

async function renderPdfPreview(pdfPath: string, dir: string) {
  await execFileAsync(
    "/usr/bin/qlmanage",
    ["-t", "-s", "2000", "-o", dir, pdfPath],
    { maxBuffer: 10 * 1024 * 1024 },
  );

  const files = await readdir(dir);
  const png = files.find((file) => file.endsWith(".png"));
  return png ? join(dir, png) : null;
}

export async function localOcrFromUpload(file: File) {
  const dir = await mkdtemp(join(tmpdir(), "jft-ocr-"));

  try {
    const extension = file.type === "application/pdf"
      ? ".pdf"
      : file.type === "image/png"
      ? ".png"
      : file.type === "image/webp"
      ? ".webp"
      : file.type === "image/gif"
      ? ".gif"
      : ".jpg";

    const uploadPath = join(dir, `upload${extension}`);
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(uploadPath, bytes);

    if (file.type === "application/pdf") {
      const previewPath = await renderPdfPreview(uploadPath, dir);
      if (!previewPath) return "";
      const visionText = await runVisionOcr(previewPath).catch(() => "");
      if (visionText) return visionText;
      return await runTesseract(previewPath);
    }

    const visionText = await runVisionOcr(uploadPath).catch(() => "");
    if (visionText) return visionText;
    return await runTesseract(uploadPath);
  } catch {
    return "";
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function localVisionObservationsFromUpload(file: File) {
  const dir = await mkdtemp(join(tmpdir(), "jft-ocr-"));

  try {
    const extension = file.type === "application/pdf"
      ? ".pdf"
      : file.type === "image/png"
      ? ".png"
      : file.type === "image/webp"
      ? ".webp"
      : file.type === "image/gif"
      ? ".gif"
      : ".jpg";

    const uploadPath = join(dir, `upload${extension}`);
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(uploadPath, bytes);

    const targetPath = file.type === "application/pdf"
      ? await renderPdfPreview(uploadPath, dir)
      : uploadPath;

    if (!targetPath) return [];
    return await runVisionOcrJson(targetPath).catch(() => []);
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
