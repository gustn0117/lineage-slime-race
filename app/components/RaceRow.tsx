"use client";

import { LANE_COUNT, Race } from "@/lib/types";

type Props = {
  race: Race;
  readOnly?: boolean;
  onChange?: (race: Race) => void;
  onDelete?: () => void;
};

function timeLabel(t: string): string {
  const [hhStr, mm] = t.split(":");
  const hh = Number(hhStr);
  const period = hh < 12 ? "오전" : "오후";
  let h12 = hh % 12;
  if (h12 === 0) h12 = 12;
  return `${period} ${h12}:${mm}`;
}

export default function RaceRow({
  race,
  readOnly = false,
  onChange,
  onDelete,
}: Props) {
  const setLane = (idx: number, patch: Partial<Race["lanes"][number]>) => {
    if (!onChange) return;
    const lanes = race.lanes.map((l, i) =>
      i === idx ? { ...l, ...patch } : l
    );
    onChange({ ...race, lanes });
  };
  const setWinner = (lane: number) => {
    if (!onChange) return;
    onChange({
      ...race,
      winnerLane: race.winnerLane === lane ? null : lane,
    });
  };

  return (
    <tr>
      <td className="time-cell">{timeLabel(race.time)}</td>
      {Array.from({ length: LANE_COUNT }, (_, i) => {
        const lane = race.lanes[i];
        const isWinner = race.winnerLane === i + 1;
        const hasData = lane.slime.trim().length > 0;

        if (readOnly) {
          return (
            <td key={i} className={isWinner ? "lane-bg-winner" : ""}>
              <div className="flex items-center gap-1.5 px-1">
                {typeof lane.number === "number" && (
                  <span className="text-xs tabular-nums text-zinc-400 w-8 text-center shrink-0">
                    {lane.number}
                  </span>
                )}
                <span
                  className={`flex-1 truncate text-sm ${
                    hasData ? "text-zinc-100" : "text-zinc-700"
                  } ${isWinner ? "font-semibold" : ""}`}
                >
                  {lane.slime || "-"}
                </span>
                {isWinner && (
                  <span className="text-[10px] text-yellow-400">★</span>
                )}
              </div>
            </td>
          );
        }

        return (
          <td key={i} className={isWinner ? "lane-bg-winner" : ""}>
            <div className="flex items-center gap-1">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={lane.number ?? ""}
                onChange={(e) =>
                  setLane(i, {
                    number:
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                  })
                }
                className="num-input"
                placeholder="#"
              />
              <input
                list="slime-names"
                value={lane.slime}
                onChange={(e) => setLane(i, { slime: e.target.value })}
                className="slime-input"
                placeholder="슬라임"
              />
              <button
                type="button"
                onClick={() => setWinner(i + 1)}
                disabled={!hasData}
                title={isWinner ? "우승 취소" : "우승 지정"}
                className={`star-btn ${isWinner ? "is-winner" : ""}`}
              >
                ★
              </button>
            </div>
          </td>
        );
      })}
      <td>
        {!readOnly && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-zinc-600 hover:text-red-400 transition"
            title="삭제"
          >
            ✕
          </button>
        )}
      </td>
    </tr>
  );
}
