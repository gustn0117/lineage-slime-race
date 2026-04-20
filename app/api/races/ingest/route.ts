import { NextRequest, NextResponse } from "next/server";
import { listRaces, saveRace } from "@/lib/db";
import { LANE_COUNT, Race, RaceLane } from "@/lib/types";

// 에이전트 전용 엔드포인트.
// 인증: Authorization: Bearer <INGEST_TOKEN>
//
// 바디 형식 (discriminated union):
//   1) { type: "lineup", date?, time?, lanes: [{lane, slime, number?}] x 5 }
//      - 해당 date+time에 경기가 없으면 생성, 있으면 라인업만 갱신.
//      - winnerLane은 null로 유지 (이미 지정돼 있으면 건드리지 않음).
//   2) { type: "winner", winnerName, winnerNumber?, round? }
//      - 가장 최근 미확정 경기(winnerLane === null)를 찾아
//        라인업의 이름/번호와 매칭해서 winnerLane을 확정.

const TOKEN = process.env.INGEST_TOKEN ?? "";

function authOK(req: NextRequest): boolean {
  if (!TOKEN) return false;
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ")) return false;
  return h.slice(7) === TOKEN;
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function currentTimeStr(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sanitizeLanes(
  raw: unknown
): RaceLane[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length !== LANE_COUNT) return null;
  return raw.map((l, i) => {
    const obj = (l ?? {}) as { slime?: unknown; number?: unknown };
    return {
      lane: i + 1,
      slime: String(obj.slime ?? "").trim(),
      number:
        typeof obj.number === "number" && Number.isFinite(obj.number)
          ? obj.number
          : undefined,
    };
  });
}

// 새 경기 이벤트(라인업 or 우승자) 들어올 때, 그보다 이전의 미확정 레이스를
// "값 있는 첫 레인"을 우승으로 자동 확정. race가 미완인 채로 계속 남아있는 걸
// 방지. 이미 확정된(winnerLane !== null) 레이스는 건드리지 않음.
async function finalizeOlderPending(
  cutoffDate: string,
  cutoffTime: string,
  all: Race[]
): Promise<void> {
  const cutoffKey = `${cutoffDate} ${cutoffTime}`;
  for (const race of all) {
    if (race.winnerLane !== null) continue;
    const key = `${race.date} ${race.time}`;
    if (key >= cutoffKey) continue;
    const firstFilledIdx = race.lanes.findIndex(
      (l) => l.slime && l.slime.trim().length > 0
    );
    if (firstFilledIdx >= 0) {
      await saveRace({ ...race, winnerLane: firstFilledIdx + 1 });
    }
  }
}

function nameMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // 짧은 쪽의 50% 이상 문자가 겹치면 매칭 (agent가 이미 1차 보정을 하므로
  // 기본은 거의 exact match이고 이 로직은 방어용).
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  let hit = 0;
  for (const ch of shorter) {
    if (longer.includes(ch)) hit++;
  }
  return hit / shorter.length >= 0.5;
}

type Body =
  | {
      type: "lineup";
      date?: string;
      time?: string;
      lanes: Array<{ lane?: number; slime?: string; number?: number }>;
    }
  | {
      type: "winner";
      winnerName: string;
      winnerNumber?: number;
      round?: number;
      date?: string;
      time?: string;
    };

export async function POST(req: NextRequest) {
  if (!authOK(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body?.type === "lineup") {
    const lanes = sanitizeLanes(body.lanes);
    if (!lanes) {
      return NextResponse.json(
        { error: `lanes must have exactly ${LANE_COUNT} items` },
        { status: 400 }
      );
    }
    if (lanes.every((l) => !l.slime)) {
      return NextResponse.json(
        { error: "at least one slime name required" },
        { status: 400 }
      );
    }
    const date = body.date ?? todayStr();
    const time = body.time ?? currentTimeStr();

    const all = await listRaces();

    // 이전 미확정 레이스가 남아있으면 "값 있는 첫 레인"으로 자동 확정.
    await finalizeOlderPending(date, time, all);

    const existing = all.find((r) => r.date === date && r.time === time);
    if (existing) {
      const updated: Race = { ...existing, lanes };
      const saved = await saveRace(updated);
      return NextResponse.json({ race: saved, action: "updated" });
    }
    const race: Race = {
      id: makeId(),
      date,
      time,
      lanes,
      winnerLane: null,
      createdAt: Date.now(),
    };
    const saved = await saveRace(race);
    return NextResponse.json({ race: saved, action: "created" });
  }

  if (body?.type === "winner") {
    const winnerName = (body.winnerName ?? "").trim();
    const winnerNumber =
      typeof body.winnerNumber === "number" ? body.winnerNumber : undefined;
    if (!winnerName) {
      return NextResponse.json(
        { error: "winnerName is required" },
        { status: 400 }
      );
    }

    const all = await listRaces();
    // 가장 최근 미확정 경기
    const pending = [...all]
      .filter((r) => r.winnerLane === null)
      .sort((a, b) =>
        `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)
      )[0];

    // 현재 pending보다 더 오래된 미확정은 자동 확정 (pending은 우승자 매칭으로
    // 이번 요청에서 처리되므로 제외).
    if (pending) {
      await finalizeOlderPending(pending.date, pending.time, all);
    }

    if (!pending) {
      // 미확정 레이스가 없는데 우승자만 들어온 경우.
      // 이전에는 fallback 레이스를 만들어서 1레인에만 우승자를 박았지만,
      // 두 번째 OCR 오탐이 이걸 만들어내는 부작용이 컸음. 그냥 404로 무시.
      return NextResponse.json(
        {
          error: "no pending race; winner ignored",
          winnerName,
          winnerNumber,
        },
        { status: 404 }
      );
    }

    // 1차: 이름 + (있으면) 번호 모두 일치
    let matched = pending.lanes.find(
      (l) =>
        (winnerNumber === undefined || l.number === winnerNumber) &&
        nameMatches(l.slime, winnerName)
    );
    // 2차: 번호만 일치 (이름 OCR 오류 대비)
    if (!matched && winnerNumber !== undefined) {
      matched = pending.lanes.find((l) => l.number === winnerNumber);
    }
    // 3차: 이름만 일치
    if (!matched) {
      matched = pending.lanes.find((l) => nameMatches(l.slime, winnerName));
    }

    if (matched) {
      const updated: Race = { ...pending, winnerLane: matched.lane };
      const saved = await saveRace(updated);
      return NextResponse.json({
        race: saved,
        matchedLane: matched.lane,
        matchedSlime: matched.slime,
      });
    }

    // 4차: 라인업에 없는 이름. 빈 레인(slime이 공백) 중 가장 작은 번호 레인을
    //       우승자로 채움. 에이전트가 한두 레인 스캔 실패했는데 우승자가 그
    //       레인의 슬라임이었던 경우 자동 복구.
    const emptyIdx = pending.lanes.findIndex(
      (l) => !l.slime || l.slime.trim() === ""
    );
    if (emptyIdx >= 0) {
      const newLanes = pending.lanes.map((l, i) =>
        i === emptyIdx
          ? {
              lane: i + 1,
              slime: winnerName,
              number: winnerNumber,
            }
          : l
      );
      const updated: Race = {
        ...pending,
        lanes: newLanes,
        winnerLane: emptyIdx + 1,
      };
      const saved = await saveRace(updated);
      return NextResponse.json({
        race: saved,
        matchedLane: emptyIdx + 1,
        matchedSlime: winnerName,
        filledEmptyLane: true,
      });
    }

    return NextResponse.json(
      {
        error: "no slime in pending race matched the winner",
        pendingRaceId: pending.id,
        winnerName,
        winnerNumber,
      },
      { status: 404 }
    );
  }

  return NextResponse.json(
    { error: "type must be 'lineup' or 'winner'" },
    { status: 400 }
  );
}
