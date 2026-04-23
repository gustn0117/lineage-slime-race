// 통계 계산 유틸 - 순수 함수

import { LANE_COUNT, LaneStat, Race, SlimeStat } from "./types";

// 공백/트레일링 스페이스 차이로 같은 슬라임이 두 행으로 쪼개지는 걸 막기 위한 정규화.
// lib/slimes.ts 의 slimeNumber() 와 동일한 규칙이어야 #N 라벨이 일관되게 붙음.
function canonicalSlimeName(name: string): string {
  return (name ?? "").trim().replace(/\s+/g, "");
}

export function todayString(tzOffsetMs = 0): string {
  const d = new Date(Date.now() + tzOffsetMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 시간순 오름차순 정렬 반환
function sortedAsc(races: Race[]): Race[] {
  return [...races].sort((a, b) => {
    const aKey = `${a.date} ${a.time}`;
    const bKey = `${b.date} ${b.time}`;
    return aKey.localeCompare(bKey);
  });
}

export function computeSlimeStats(
  races: Race[],
  recentWindow: number,
  today: string
): SlimeStat[] {
  const asc = sortedAsc(races);
  const recent = asc.slice(Math.max(0, asc.length - recentWindow));

  const all = new Map<string, SlimeStat>();

  const touch = (name: string): SlimeStat => {
    let s = all.get(name);
    if (!s) {
      s = {
        name,
        total: 0,
        wins: 0,
        winRate: 0,
        recentTotal: 0,
        recentWins: 0,
        recentWinRate: 0,
        todayTotal: 0,
        todayWins: 0,
      };
      all.set(name, s);
    }
    return s;
  };

  for (const r of asc) {
    for (const l of r.lanes) {
      if (!l.slime) continue;
      const name = canonicalSlimeName(l.slime);
      if (!name) continue;
      const s = touch(name);
      s.total += 1;
      if (r.winnerLane === l.lane) s.wins += 1;
      if (r.date === today) {
        s.todayTotal += 1;
        if (r.winnerLane === l.lane) s.todayWins += 1;
      }
    }
  }

  for (const r of recent) {
    for (const l of r.lanes) {
      if (!l.slime) continue;
      const name = canonicalSlimeName(l.slime);
      if (!name) continue;
      const s = touch(name);
      s.recentTotal += 1;
      if (r.winnerLane === l.lane) s.recentWins += 1;
    }
  }

  for (const s of all.values()) {
    s.winRate = s.total > 0 ? s.wins / s.total : 0;
    s.recentWinRate = s.recentTotal > 0 ? s.recentWins / s.recentTotal : 0;
  }

  return Array.from(all.values()).sort((a, b) => {
    if (b.recentWinRate !== a.recentWinRate)
      return b.recentWinRate - a.recentWinRate;
    if (b.recentWins !== a.recentWins) return b.recentWins - a.recentWins;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return a.name.localeCompare(b.name, "ko");
  });
}

export function computeLaneStats(
  races: Race[],
  recentWindow: number
): LaneStat[] {
  const asc = sortedAsc(races);
  const recent = asc.slice(Math.max(0, asc.length - recentWindow));
  const out: LaneStat[] = [];
  for (let i = 1; i <= LANE_COUNT; i++) out.push({ lane: i, wins: 0 });
  for (const r of recent) {
    if (r.winnerLane) {
      const s = out.find((x) => x.lane === r.winnerLane);
      if (s) s.wins += 1;
    }
  }
  return out;
}

// 입력된 슬라임 이름 후보 목록 (지금까지 등장한 모든 이름)
export function allSlimeNames(races: Race[]): string[] {
  const set = new Set<string>();
  for (const r of races) {
    for (const l of r.lanes) {
      if (!l.slime) continue;
      const name = canonicalSlimeName(l.slime);
      if (name) set.add(name);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
}
