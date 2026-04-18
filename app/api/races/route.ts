import { NextRequest, NextResponse } from "next/server";
import { listRaces, saveRace } from "@/lib/db";
import { LANE_COUNT, Race } from "@/lib/types";

export async function GET() {
  const races = await listRaces();
  return NextResponse.json({ races });
}

function makeId() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<Race>;

  if (!body.date || !body.time) {
    return NextResponse.json(
      { error: "date, time은 필수입니다." },
      { status: 400 }
    );
  }

  const lanes = Array.isArray(body.lanes) ? body.lanes : [];
  if (lanes.length !== LANE_COUNT) {
    return NextResponse.json(
      { error: `레인 수는 ${LANE_COUNT}개여야 합니다.` },
      { status: 400 }
    );
  }

  const race: Race = {
    id: body.id ?? makeId(),
    date: body.date,
    time: body.time,
    lanes: lanes.map((l, i) => ({
      lane: i + 1,
      slime: String(l.slime ?? "").trim(),
      number: typeof l.number === "number" ? l.number : undefined,
    })),
    winnerLane:
      typeof body.winnerLane === "number" &&
      body.winnerLane >= 1 &&
      body.winnerLane <= LANE_COUNT
        ? body.winnerLane
        : null,
    createdAt: body.createdAt ?? Date.now(),
  };

  const saved = await saveRace(race);
  return NextResponse.json({ race: saved });
}
