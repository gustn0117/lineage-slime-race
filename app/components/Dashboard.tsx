"use client";

import AddRaceForm from "@/app/components/AddRaceForm";
import RaceCard from "@/app/components/RaceCard";
import Slime from "@/app/components/Slime";
import { LaneStatsBar, SlimeStatsTable } from "@/app/components/StatsPanel";
import {
  apiDeleteRace,
  apiGetSettings,
  apiListRaces,
  apiPatchRace,
  apiSaveRace,
  apiSaveSettings,
} from "@/lib/client";
import {
  allSlimeNames,
  computeLaneStats,
  computeSlimeStats,
  todayString,
} from "@/lib/stats";
import { AppSettings, DEFAULT_SETTINGS, Race } from "@/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Props = {
  admin?: boolean;
  onLogout?: () => void;
};

export default function Dashboard({ admin = false, onLogout }: Props) {
  const [races, setRaces] = useState<Race[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(todayString());
  const [showAll, setShowAll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([apiListRaces(), apiGetSettings()]);
      setRaces(r);
      setSettings(s);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "로딩 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const today = todayString();
  const slimeOptions = useMemo(() => allSlimeNames(races), [races]);
  const slimeStats = useMemo(
    () => computeSlimeStats(races, settings.recentWindow, today),
    [races, settings.recentWindow, today]
  );
  const laneStats = useMemo(
    () => computeLaneStats(races, settings.recentWindow),
    [races, settings.recentWindow]
  );
  const visibleRaces = useMemo(() => {
    const filtered = showAll
      ? races
      : races.filter((r) => r.date === selectedDate);
    return [...filtered].sort((a, b) => {
      const ak = `${a.date} ${a.time}`;
      const bk = `${b.date} ${b.time}`;
      return bk.localeCompare(ak);
    });
  }, [races, selectedDate, showAll]);

  const availableDates = useMemo(() => {
    const s = new Set<string>();
    for (const r of races) s.add(r.date);
    if (!s.has(today)) s.add(today);
    return Array.from(s).sort().reverse();
  }, [races, today]);

  const handleAdd = async (r: Omit<Race, "id" | "createdAt">) => {
    const saved = await apiSaveRace(r);
    setRaces((prev) => [...prev, saved]);
    if (r.date !== selectedDate && !showAll) setSelectedDate(r.date);
  };

  const handleChange = async (race: Race) => {
    setRaces((prev) => prev.map((r) => (r.id === race.id ? race : r)));
    try {
      await apiPatchRace(race.id, race);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "수정 실패");
      refresh();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("이 경기를 삭제할까요?")) return;
    const prev = races;
    setRaces((p) => p.filter((r) => r.id !== id));
    try {
      await apiDeleteRace(id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "삭제 실패");
      setRaces(prev);
    }
  };

  const updateRecent = async (n: number) => {
    const s = await apiSaveSettings({ recentWindow: n });
    setSettings(s);
  };

  if (loading) {
    return <main className="p-8 text-sm text-zinc-500">불러오는 중...</main>;
  }

  const totalToday = races.filter((r) => r.date === today).length;

  return (
    <main className="mx-auto w-full max-w-340 p-4 sm:p-7 flex flex-col gap-6">
      <datalist id="slime-names">
        {slimeOptions.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/8 pb-5">
        <div className="flex items-center gap-3">
          <Slime size={36} />
          <div className="flex flex-col">
            <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Lineage Classic · Slime Arena
              {admin && (
                <span className="ml-2 text-yellow-400/90">· Admin</span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight title-glow">
              슬라임 경주 기록판
            </h1>
          </div>
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <label className="field">
            날짜
            <select
              value={showAll ? "__all__" : selectedDate}
              onChange={(e) => {
                if (e.target.value === "__all__") {
                  setShowAll(true);
                } else {
                  setShowAll(false);
                  setSelectedDate(e.target.value);
                }
              }}
            >
              <option value="__all__">전체 보기</option>
              {availableDates.map((d) => (
                <option key={d} value={d}>
                  {d} {d === today ? "(오늘)" : ""}
                </option>
              ))}
            </select>
          </label>
          {admin && (
            <label className="field">
              최근 N경기
              <input
                type="number"
                min={1}
                max={1000}
                value={settings.recentWindow}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n) || n < 1) return;
                  setSettings((s) => ({ ...s, recentWindow: n }));
                }}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 1) updateRecent(n);
                }}
                className="w-24"
              />
            </label>
          )}
          {admin ? (
            <button type="button" className="btn" onClick={onLogout}>
              로그아웃
            </button>
          ) : (
            <Link href="/admin" className="btn">
              관리자
            </Link>
          )}
        </div>
      </header>

      {err && (
        <div className="text-xs text-red-300 border border-red-500/40 bg-red-950/40 px-3 py-2 rounded-lg flex items-center justify-between">
          <span>{err}</span>
          <button
            className="underline text-red-200"
            onClick={() => setErr(null)}
          >
            닫기
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)] gap-6">
        <div className="flex flex-col gap-5">
          {admin && (
            <AddRaceForm existingRaces={races} onAdd={handleAdd} />
          )}

          <section className="panel overflow-hidden">
            <div className="panel-head">
              <span className="flex items-center gap-2">
                <span>경기 기록</span>
                <span className="chip">
                  {showAll ? "전체" : selectedDate}
                  {!showAll && selectedDate === today && (
                    <span className="text-white/80">· 오늘</span>
                  )}
                </span>
              </span>
              <span className="text-xs text-zinc-500 font-normal">
                {visibleRaces.length}건
                {!showAll && selectedDate === today && (
                  <span className="ml-2 text-zinc-600">
                    / 오늘 누적 {totalToday}
                  </span>
                )}
              </span>
            </div>
            <div className="p-3 sm:p-4">
              {visibleRaces.length === 0 ? (
                <div className="py-10 text-center text-sm text-zinc-500">
                  {admin
                    ? "아직 기록이 없습니다. 위에서 경기를 추가하세요."
                    : "아직 기록이 없습니다."}
                </div>
              ) : (
                <div className="race-grid">
                  {visibleRaces.map((r) => (
                    <RaceCard
                      key={r.id}
                      race={r}
                      readOnly={!admin}
                      onChange={admin ? handleChange : undefined}
                      onDelete={admin ? () => handleDelete(r.id) : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-5">
          <LaneStatsBar
            lanes={laneStats}
            recentWindow={settings.recentWindow}
          />
          <SlimeStatsTable
            stats={slimeStats}
            recentWindow={settings.recentWindow}
          />
        </aside>
      </div>
    </main>
  );
}
