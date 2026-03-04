import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    version: "0.2.0",
    timestamp: new Date().toISOString(),
    features: ["admin-key-auth", "rate-limiting", "match-management"],
  });
}
