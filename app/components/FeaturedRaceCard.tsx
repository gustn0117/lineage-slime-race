"use client";

import { DatePicker, TimePicker } from "@/app/components/DateTimePicker";
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

function dateLabel(d: string): string {
  const [y, m, day] = d.split("-");
  return `${y}.${m}.${day}`;
}

export default function FeaturedRaceCard({
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
    <div className="race-featured">
      <div className="race-featured-head">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="race-featured-latest">최근 경기</span>
          {readOnly ? (
            <div className="flex items-baseline gap-3">
              <span className="race-featured-time">{timeLabel(race.time)}</span>
              <span className="race-featured-date">{dateLabel(race.date)}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <DatePicker
                value={race.date}
                onChange={(v) => onChange && onChange({ ...race, date: v })}
              />
              <TimePicker
                value={race.time}
                onChange={(v) => onChange && onChange({ ...race, time: v })}
                step={10}
              />
            </div>
          )}
        </div>
        {!readOnly && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="text-sm text-zinc-500 hover:text-red-400 transition px-2"
            title="삭제"
          >
            ✕
          </button>
        )}
      </div>
      <div className="race-card-lanes">
        {Array.from({ length: LANE_COUNT }, (_, i) => {
          const lane = race.lanes[i];
          const isWinner = race.winnerLane === i + 1;
          const hasData = lane.slime.trim().length > 0;
          return (
            <div
              key={i}
              className={`lane-row ${isWinner ? "lane-bg-winner" : ""}`}
            >
              <span className="lane-label">
                <span className="lane-dot" />
                {i + 1}레인
              </span>

              {readOnly ? (
                <>
                  <span
                    className={`lane-name-display ${
                      hasData ? "" : "text-zinc-700"
                    } ${isWinner ? "is-winner" : ""}`}
                  >
                    {lane.slime || "-"}
                  </span>
                  {isWinner && <span className="winner-star">★</span>}
                </>
              ) : (
                <>
                  <input
                    list="slime-names"
                    value={lane.slime}
                    onChange={(e) => setLane(i, { slime: e.target.value })}
                    className="slime-input"
                    placeholder="슬라임 이름"
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
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
