"use client";

import { LANE_COUNT, Race } from "@/lib/types";

type Props = {
  race: Race;
  onChange: (race: Race) => void;
  onDelete: () => void;
};

function timeLabel(t: string): string {
  const [hhStr, mm] = t.split(":");
  const hh = Number(hhStr);
  const period = hh < 12 ? "오전" : "오후";
  let h12 = hh % 12;
  if (h12 === 0) h12 = 12;
  return `${period} ${h12}:${mm}`;
}

export default function RaceRow({ race, onChange, onDelete }: Props) {
  const setLane = (idx: number, patch: Partial<Race["lanes"][number]>) => {
    const lanes = race.lanes.map((l, i) =>
      i === idx ? { ...l, ...patch } : l
    );
    onChange({ ...race, lanes });
  };
  const setWinner = (lane: number) => {
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
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-zinc-600 hover:text-red-400 transition"
          title="삭제"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
