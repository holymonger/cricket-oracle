import { createWorker } from "tesseract.js";

export type OcrResult = {
  rawText: string;
  provider: "tesseract.js";
};

export async function extractTextFromImageBuffer(imageBuffer: Buffer): Promise<OcrResult> {
  const worker = await createWorker("eng", 1, {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js",
    langPath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js",
  });
  
  try {
    const {
      data: { text },
    } = await worker.recognize(imageBuffer);

    return {
      rawText: (text || "").trim(),
      provider: "tesseract.js",
    };
  } finally {
    await worker.terminate();
  }
}
