"use client";

import { LaneStat, SlimeStat } from "@/lib/types";

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export function SlimeStatsTable({
  stats,
  recentWindow,
}: {
  stats: SlimeStat[];
  recentWindow: number;
}) {
  const ranked = [...stats].sort((a, b) => {
    if (b.todayWins !== a.todayWins) return b.todayWins - a.todayWins;
    if (b.recentWinRate !== a.recentWinRate)
      return b.recentWinRate - a.recentWinRate;
    return b.winRate - a.winRate;
  });

  return (
    <div className="panel overflow-hidden">
      <div className="panel-head">
        <span>승률 랭킹</span>
        <span className="chip">최근 {recentWindow}경기</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-zinc-500 font-display">
              <th className="px-3 py-2 text-left font-bold">#</th>
              <th className="px-2 py-2 text-left font-bold">슬라임</th>
              <th className="px-2 py-2 text-right font-bold">오늘</th>
              <th className="px-2 py-2 text-left font-bold">최근 승률</th>
              <th className="px-2 py-2 text-right font-bold">전체</th>
            </tr>
          </thead>
          <tbody>
            {ranked.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-6 text-center text-zinc-500">
                  아직 데이터가 없습니다.
                </td>
              </tr>
            )}
            {ranked.map((s, idx) => {
              const rank = idx + 1;
              const rankClass =
                rank <= 3 ? `rank-badge rank-${rank}` : "rank-badge";
              const recentWidth =
                s.recentTotal > 0 ? Math.round(s.recentWinRate * 100) : 0;
              return (
                <tr
                  key={s.name}
                  className="border-t border-white/5 hover:bg-white/2"
                >
                  <td className="px-3 py-2">
                    <span className={rankClass}>{rank}</span>
                  </td>
                  <td className="px-2 py-2 font-semibold text-zinc-100 whitespace-nowrap">
                    {s.name}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    <span
                      className={
                        s.todayWins > 0
                          ? "text-white font-bold"
                          : "text-zinc-600"
                      }
                    >
                      {s.todayWins}
                    </span>
                    <span className="text-zinc-600">/{s.todayTotal}</span>
                  </td>
                  <td className="px-2 py-2">
                    {s.recentTotal > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className="winrate-bar flex-1 min-w-15">
                          <span style={{ width: `${recentWidth}%` }} />
                        </div>
                        <span className="text-xs tabular-nums text-zinc-200 w-12 text-right">
                          {pct(s.recentWinRate)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-zinc-600 text-xs">-</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right text-xs text-zinc-400 tabular-nums">
                    {s.total > 0 ? pct(s.winRate) : "-"}
                    <span className="ml-1 text-zinc-600">
                      ({s.wins}/{s.total})
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LaneStatsBar({ lanes }: { lanes: LaneStat[] }) {
  const max = Math.max(1, ...lanes.map((l) => l.wins));
  const total = lanes.reduce((sum, l) => sum + l.wins, 0);
  return (
    <div className="panel overflow-hidden">
      <div className="panel-head">
        <span>오늘 레인별 승리</span>
        <span className="chip">총 {total}승</span>
      </div>
      <div className="grid grid-cols-5 divide-x divide-white/5">
        {lanes.map((l) => {
          const widthPct = (l.wins / max) * 100;
          return (
            <div
              key={l.lane}
              className="p-3 text-center flex flex-col items-center gap-1.5"
            >
              <div className="text-[10px] font-bold tracking-widest text-zinc-500 font-display">
                {l.lane}레인
              </div>
              <div className="text-2xl font-black tabular-nums text-zinc-100 font-display">
                {l.wins}
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/6 overflow-hidden">
                <div
                  className="h-full rounded-full bg-zinc-200"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
