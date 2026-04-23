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

// "HH:MM" → "HH:MM" where MM is floored to nearest 10-min mark.
// 경기는 10분 단위(:00, :10, :20, ...) 로 돌아가는데 에이전트가 :21 / :29 처럼
// 분 단위 편차로 보내오면 기록 시각을 항상 :X0 로 스냅해 통일.
function snapToTenMin(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return t;
  const hh = pad(Math.min(23, Math.max(0, parseInt(m[1], 10))));
  const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  const snapped = Math.floor(mm / 10) * 10;
  return `${hh}:${pad(snapped)}`;
}

function currentTimeStr(): string {
  const d = new Date();
  return snapToTenMin(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
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

// (과거) 이전 미확정 레이스의 첫 채운 레인을 자동 우승으로 확정하던 로직은
// 제거됨. 우승자 OCR 을 놓친 경기를 "1레인 승"으로 잘못 기록해서 통계가 오염됨.
// 미확정 레이스는 그대로 winnerLane === null 로 남겨서 /admin 에서 수동 확정.

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
    // 에이전트가 :21 / :29 / :35 같은 분 단위 편차를 보내도 항상 :X0 으로 내림.
    const time = snapToTenMin(body.time ?? currentTimeStr());

    const all = await listRaces();

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

    // (과거) 라인업에 없는 이름일 경우 빈 레인에 끼워넣던 4차 fallback 제거.
    // 잘못된 OCR 결과를 empty 레인에 덮어 써서 오염된 기록을 만드는 부작용이 큼.
    // 미매칭은 그냥 404 로 거부하고 기록은 pending 상태 유지.
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
