"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface ExtractedData {
  rawText: string;
  extracted: {
    runs?: number;
    wickets?: number;
    balls?: number;
    targetRuns?: number;
  };
  confidence: Record<string, number>;
  provider?: "manual" | "tesseract.js";
}

export default function UploadPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExtractedData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState("");

  async function handleExtractFromText() {
    if (!rawText.trim()) {
      alert("Please paste OCR text");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/extract-scorecard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rawText }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Extraction failed");
      }

      setResult(data);
    } catch (error) {
      alert("Error: " + String(error));
    } finally {
      setLoading(false);
    }
  }

  async function handleExtractFromImage() {
    if (!file) {
      alert("Please choose an image");
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/extract-scorecard", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "OCR extraction failed");
      }

      setResult(data);
      if (data?.rawText) {
        setRawText(String(data.rawText));
      }
    } catch (error) {
      alert("Error: " + String(error));
    } finally {
      setLoading(false);
    }
  }

  function handleApplyToForm() {
    if (!result?.extracted) return;

    const params = new URLSearchParams();
    if (result.extracted.runs !== undefined) params.set("runs", String(result.extracted.runs));
    if (result.extracted.wickets !== undefined) params.set("wickets", String(result.extracted.wickets));
    if (result.extracted.balls !== undefined) params.set("balls", String(result.extracted.balls));
    if (result.extracted.targetRuns !== undefined) {
      params.set("targetRuns", String(result.extracted.targetRuns));
    }

    const query = params.toString();
    router.push(query ? `/match?${query}` : "/match");
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">📸 Upload Scorecard</h1>
        <Link href="/match" className="text-blue-600 hover:underline text-sm">
          ← Back to Match
        </Link>
      </div>

      <div className="border rounded p-6 space-y-4 bg-blue-50">
        <h2 className="text-lg font-semibold">1) Upload Image (v1 OCR)</h2>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full border rounded p-2 bg-white"
          disabled={loading}
        />
        <button
          onClick={handleExtractFromImage}
          disabled={loading || !file}
          className="w-full bg-indigo-600 text-white rounded px-4 py-3 disabled:opacity-50 font-semibold"
        >
          {loading ? "Running OCR..." : "Extract from Image"}
        </button>

        <div className="border-t pt-4" />

        <h2 className="text-lg font-semibold">2) Or Paste OCR Text (fallback)</h2>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder='Example: Team A 123/4, Overs 12.3, Target 178, Need 50 from 30'
          className="w-full border rounded p-3 h-40 font-mono text-xs bg-white"
          disabled={loading}
        />
        <button
          onClick={handleExtractFromText}
          disabled={loading || !rawText.trim()}
          className="w-full bg-blue-600 text-white rounded px-4 py-3 disabled:opacity-50 font-semibold"
        >
          {loading ? "Extracting..." : "Extract from Text"}
        </button>
      </div>

      {result && (
        <div className="border rounded p-6 space-y-4 bg-green-50">
          <h2 className="text-lg font-semibold">Extraction Result</h2>
          <div className="text-sm text-gray-700">
            Provider: <span className="font-semibold">{result.provider ?? "manual"}</span>
          </div>

          <div className="space-y-3">
            <div className="border rounded p-3 bg-white">
              <div className="text-xs font-semibold text-gray-600 mb-2">Extracted JSON</div>
              <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">
                {JSON.stringify(result.extracted, null, 2)}
              </pre>
            </div>
            <div className="border rounded p-3 bg-white">
              <div className="text-xs font-semibold text-gray-600 mb-2">Confidence JSON</div>
              <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">
                {JSON.stringify(result.confidence, null, 2)}
              </pre>
            </div>
          </div>

          <button
            onClick={handleApplyToForm}
            className="w-full bg-green-600 text-white rounded px-4 py-3 font-semibold hover:bg-green-700"
          >
            Apply to Match Form
          </button>
        </div>
      )}
    </div>
  );
}
