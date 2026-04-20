"use client";

import { DatePicker, TimePicker } from "@/app/components/DateTimePicker";
import { LANE_COUNT, Race } from "@/lib/types";
import { useState } from "react";

function nextRaceTime(existing: Race[], date: string): string {
  const todays = existing.filter((r) => r.date === date);
  if (todays.length === 0) return "00:00";
  const sorted = [...todays].sort((a, b) => a.time.localeCompare(b.time));
  const last = sorted[sorted.length - 1].time;
  const [hh, mm] = last.split(":").map(Number);
  const total = hh * 60 + mm + 10;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type Props = {
  existingRaces: Race[];
  onAdd: (race: Omit<Race, "id" | "createdAt">) => Promise<void>;
};

type Draft = { slime: string; number: string };

const emptyDraft = (): Draft => ({ slime: "", number: "" });

export default function AddRaceForm({ existingRaces, onAdd }: Props) {
  const [date, setDate] = useState<string>(todayLocal());
  const [time, setTime] = useState<string>(() =>
    nextRaceTime(existingRaces, todayLocal())
  );
  const [lanes, setLanes] = useState<Draft[]>(() =>
    Array.from({ length: LANE_COUNT }, emptyDraft)
  );
  const [winner, setWinner] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const changeLane = (i: number, patch: Partial<Draft>) => {
    setLanes((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const reset = (newDate = date) => {
    setLanes(Array.from({ length: LANE_COUNT }, emptyDraft));
    setWinner(null);
    setTime(nextRaceTime(existingRaces, newDate));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (lanes.every((l) => !l.slime.trim())) {
      setErr("슬라임 이름을 하나 이상 입력해주세요.");
      return;
    }
    setBusy(true);
    try {
      await onAdd({
        date,
        time,
        winnerLane: winner,
        lanes: lanes.map((l, i) => ({
          lane: i + 1,
          slime: l.slime.trim(),
          number: l.number === "" ? undefined : Number(l.number),
        })),
      });
      reset();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel overflow-hidden">
      <div className="panel-head">
        <span>경기 추가</span>
        <span className="text-[11px] text-zinc-500 font-normal">
          별(★)로 우승 지정
        </span>
      </div>

      <div className="p-4 flex flex-col gap-4">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <span className="field-label">날짜</span>
            <DatePicker
              value={date}
              onChange={(v) => {
                setDate(v);
                setTime(nextRaceTime(existingRaces, v));
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="field-label">시간</span>
            <TimePicker value={time} onChange={setTime} step={10} />
          </div>
          <button
            type="button"
            onClick={() => setTime(nextRaceTime(existingRaces, date))}
            className="btn"
          >
            +10분
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          {Array.from({ length: LANE_COUNT }, (_, i) => {
            const l = lanes[i];
            const isWinner = winner === i + 1;
            return (
              <div
                key={i}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 border border-white/5 ${
                  isWinner ? "lane-bg-winner" : "bg-white/2"
                }`}
              >
                <span className="w-14 shrink-0 text-[11px] font-bold tracking-wider text-zinc-400 font-display flex items-center gap-1.5">
                  <span className="lane-dot" />
                  {i + 1}레인
                </span>
                <input
                  list="slime-names"
                  value={l.slime}
                  onChange={(e) => changeLane(i, { slime: e.target.value })}
                  className="slime-input"
                  placeholder="슬라임 이름"
                />
                <button
                  type="button"
                  onClick={() => setWinner(winner === i + 1 ? null : i + 1)}
                  disabled={!l.slime.trim()}
                  className={`star-btn ${isWinner ? "is-winner" : ""}`}
                  title="우승 지정"
                >
                  ★
                </button>
              </div>
            );
          })}
        </div>

        {err && <div className="text-xs text-red-300">{err}</div>}

        <div className="flex items-center gap-2">
          <button type="submit" disabled={busy} className="btn btn-primary">
            {busy ? "저장 중..." : "경기 추가"}
          </button>
          <button type="button" onClick={() => reset()} className="btn">
            초기화
          </button>
        </div>
      </div>
    </form>
  );
}
