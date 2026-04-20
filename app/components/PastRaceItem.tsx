"use client";

import RaceCard from "@/app/components/RaceCard";
import { Race } from "@/lib/types";
import { useState } from "react";

type Props = {
  race: Race;
  admin?: boolean;
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

export default function PastRaceItem({
  race,
  admin = false,
  onChange,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const winnerLane = race.winnerLane
    ? race.lanes.find((l) => l.lane === race.winnerLane)
    : null;

  return (
    <div className="past-race">
      <button
        type="button"
        className="past-race-summary"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="past-time">{timeLabel(race.time)}</span>

        {race.winnerLane && winnerLane ? (
          <>
            <span className="past-winner-chip">{race.winnerLane}레인</span>
            <span className="past-winner-name">
              {typeof winnerLane.number === "number" && (
                <span className="past-num">#{winnerLane.number}</span>
              )}
              <span className="past-slime">{winnerLane.slime || "-"}</span>
            </span>
            <span className="past-star">★</span>
          </>
        ) : (
          <span className="past-pending">미확정</span>
        )}

        <span className={`past-chevron ${open ? "open" : ""}`} aria-hidden>
          ›
        </span>
      </button>

      {open && (
        <div className="past-race-edit">
          <RaceCard
            race={race}
            readOnly={!admin}
            onChange={admin ? onChange : undefined}
            onDelete={admin ? onDelete : undefined}
          />
        </div>
      )}
    </div>
  );
}
