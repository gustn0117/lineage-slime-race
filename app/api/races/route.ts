import { NextRequest, NextResponse } from "next/server";
import { listRaces, saveRace } from "@/lib/db";
import { isCanonicalSlimeName } from "@/lib/slimes";
import { LANE_COUNT, Race } from "@/lib/types";
import { isAdminRequest } from "@/lib/admin";

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
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
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

  // 빈 칸은 허용. 입력된 이름은 공식 슬라임 목록에 있어야 함 (오타 차단).
  const invalid = lanes
    .map((l, i) => ({ name: String(l.slime ?? "").trim(), lane: i + 1 }))
    .filter((x) => x.name && !isCanonicalSlimeName(x.name));
  if (invalid.length) {
    return NextResponse.json(
      {
        error: `슬라임 이름 오타: ${invalid
          .map((x) => `${x.lane}레인 "${x.name}"`)
          .join(", ")}`,
      },
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
