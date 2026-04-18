"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const WD = ["일", "월", "화", "수", "목", "금", "토"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(v: string): [number, number, number] {
  const [y, m, d] = v.split("-").map(Number);
  return [y, m, d];
}

function formatDateLabel(v: string) {
  const [y, m, d] = parseDate(v);
  const dt = new Date(y, m - 1, d);
  return `${y}.${pad(m)}.${pad(d)} (${WD[dt.getDay()]})`;
}

function useClickOutside<T extends HTMLElement>(
  onOut: () => void
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onOut();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onOut]);
  return ref;
}

export function DatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [y, m] = parseDate(value);
  const [viewY, setViewY] = useState(y);
  const [viewM, setViewM] = useState(m);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));

  useEffect(() => {
    setViewY(y);
    setViewM(m);
  }, [y, m]);

  const todayStr = toStr(new Date());

  const cells = useMemo(() => {
    const first = new Date(viewY, viewM - 1, 1);
    const firstWd = first.getDay();
    const start = new Date(viewY, viewM - 1, 1 - firstWd);
    const result: Array<{ date: string; day: number; outside: boolean }> = [];
    for (let i = 0; i < 42; i++) {
      const dt = new Date(start);
      dt.setDate(start.getDate() + i);
      result.push({
        date: toStr(dt),
        day: dt.getDate(),
        outside: dt.getMonth() !== viewM - 1,
      });
    }
    return result;
  }, [viewY, viewM]);

  const shift = (delta: number) => {
    let nm = viewM + delta;
    let ny = viewY;
    while (nm < 1) {
      nm += 12;
      ny--;
    }
    while (nm > 12) {
      nm -= 12;
      ny++;
    }
    setViewM(nm);
    setViewY(ny);
  };

  return (
    <div className="dtp-wrap" ref={ref}>
      <button
        type="button"
        className="dtp-btn"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
          <rect
            x="2"
            y="3"
            width="12"
            height="11"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path
            d="M5 1.5v3M11 1.5v3M2 7h12"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        <span>{formatDateLabel(value)}</span>
      </button>
      {open && (
        <div className="dtp-pop">
          <div className="dtp-head">
            <button type="button" onClick={() => shift(-1)} aria-label="이전 달">
              ‹
            </button>
            <span>
              {viewY}년 {viewM}월
            </span>
            <button type="button" onClick={() => shift(1)} aria-label="다음 달">
              ›
            </button>
          </div>
          <div className="dtp-wd">
            {WD.map((w, i) => (
              <span
                key={w}
                className={i === 0 ? "sun" : i === 6 ? "sat" : undefined}
              >
                {w}
              </span>
            ))}
          </div>
          <div className="dtp-days">
            {cells.map((c, i) => {
              const selected = c.date === value;
              const isToday = c.date === todayStr;
              const col = i % 7;
              return (
                <button
                  key={c.date + i}
                  type="button"
                  onClick={() => {
                    onChange(c.date);
                    setOpen(false);
                  }}
                  className={[
                    "dtp-cell",
                    c.outside ? "outside" : "",
                    selected ? "selected" : "",
                    isToday ? "today" : "",
                    col === 0 ? "sun" : "",
                    col === 6 ? "sat" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {c.day}
                </button>
              );
            })}
          </div>
          <div className="dtp-foot">
            <button
              type="button"
              onClick={() => {
                onChange(todayStr);
                setOpen(false);
              }}
            >
              오늘
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TimePicker({
  value,
  onChange,
  step = 10,
}: {
  value: string;
  onChange: (v: string) => void;
  step?: number;
}) {
  const [open, setOpen] = useState(false);
  const [hhStr, mmStr] = value.split(":");
  const hh = Number(hhStr);
  const mm = Number(mmStr);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));

  const period = hh < 12 ? "오전" : "오후";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const label = `${period} ${h12}:${pad(mm)}`;

  const minutes = useMemo(() => {
    const out: number[] = [];
    for (let m = 0; m < 60; m += step) out.push(m);
    return out;
  }, [step]);

  const setVal = (h: number, m: number) =>
    onChange(`${pad(h)}:${pad(m)}`);

  const setPeriod = (isPm: boolean) => {
    const base = hh % 12;
    const next = isPm ? base + 12 : base;
    setVal(next, mm);
  };

  const setHour12 = (h12v: number) => {
    const isPm = hh >= 12;
    const base = h12v === 12 ? 0 : h12v;
    const next = isPm ? base + 12 : base;
    setVal(next, mm);
  };

  return (
    <div className="dtp-wrap" ref={ref}>
      <button
        type="button"
        className="dtp-btn"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path
            d="M8 4v4l2.5 2"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
        <span>{label}</span>
      </button>
      {open && (
        <div className="dtp-pop dtp-pop-time">
          <div className="dtp-period">
            <button
              type="button"
              onClick={() => setPeriod(false)}
              className={hh < 12 ? "active" : ""}
            >
              오전
            </button>
            <button
              type="button"
              onClick={() => setPeriod(true)}
              className={hh >= 12 ? "active" : ""}
            >
              오후
            </button>
          </div>
          <div className="dtp-sep">시</div>
          <div className="dtp-grid dtp-hours">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((hv) => {
              const actual =
                hh < 12 ? (hv === 12 ? 0 : hv) : hv === 12 ? 12 : hv + 12;
              const active = actual === hh;
              return (
                <button
                  key={hv}
                  type="button"
                  onClick={() => setHour12(hv)}
                  className={active ? "active" : ""}
                >
                  {hv}
                </button>
              );
            })}
          </div>
          <div className="dtp-sep">분</div>
          <div className="dtp-grid dtp-mins">
            {minutes.map((mv) => {
              const active = mv === mm;
              return (
                <button
                  key={mv}
                  type="button"
                  onClick={() => {
                    setVal(hh, mv);
                    setOpen(false);
                  }}
                  className={active ? "active" : ""}
                >
                  {pad(mv)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
