import { NextResponse } from "next/server";
import { extractFromOcrText } from "@/lib/ocr/scorecardExtract";
import { extractTextFromImageBuffer } from "@/lib/ocr/provider";
import { RateLimitExceededError, rateLimitOrThrow } from "@/lib/auth/rateLimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    try {
      rateLimitOrThrow(req);
    } catch (rateLimitError) {
      if (rateLimitError instanceof RateLimitExceededError) {
        return NextResponse.json({ error: rateLimitError.message }, { status: 429 });
      }
      throw rateLimitError;
    }

    const contentType = req.headers.get("content-type") || "";

    let rawText = "";
    let provider: "manual" | "tesseract.js" = "manual";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");

      if (!(file instanceof File)) {
        return NextResponse.json({ error: "file is required" }, { status: 400 });
      }

      if (!file.type.startsWith("image/")) {
        return NextResponse.json({ error: "file must be an image" }, { status: 400 });
      }

      const bytes = await file.arrayBuffer();
      const imageBuffer = Buffer.from(bytes);
      const ocr = await extractTextFromImageBuffer(imageBuffer);
      rawText = ocr.rawText;
      provider = ocr.provider;
    } else {
      const body = await req.json().catch(() => ({}));
      rawText = typeof body?.rawText === "string" ? body.rawText : "";
      provider = "manual";
    }

    if (!rawText.trim()) {
      return NextResponse.json(
        { error: "No OCR text detected. Try a clearer image or paste rawText manually." },
        { status: 400 }
      );
    }

    const { extracted, confidence } = extractFromOcrText(rawText);

    return NextResponse.json({
      rawText,
      extracted,
      confidence,
      provider,
    });
  } catch (error) {
    console.error("Error extracting scorecard:", error);
    return NextResponse.json(
      { error: "Failed to extract scorecard", details: String(error) },
      { status: 500 }
    );
  }
}
