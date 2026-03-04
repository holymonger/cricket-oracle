import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const CreateMatchSchema = z.object({
  teamA: z.string().min(1),
  teamB: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = CreateMatchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { teamA, teamB } = parsed.data;
    const match = await prisma.match.create({
      data: { teamA, teamB },
    });

    return NextResponse.json({ matchId: match.id });
  } catch (error) {
    console.error("Error creating match:", error);
    return NextResponse.json(
      { error: "Server error", details: String(error) },
      { status: 500 }
    );
  }
}
