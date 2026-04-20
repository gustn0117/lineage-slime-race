import { NextResponse } from "next/server";
import { listRaces } from "@/lib/db";
import { allSlimeNames } from "@/lib/stats";

export async function GET() {
  const races = await listRaces();
  const names = allSlimeNames(races);
  return NextResponse.json({ names });
}
