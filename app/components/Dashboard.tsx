"use client";

import AddRaceForm from "@/app/components/AddRaceForm";
import AgentPanel from "@/app/components/AgentPanel";
import BannerAdmin from "@/app/components/BannerAdmin";
import BannerCarousel from "@/app/components/BannerCarousel";
import FeaturedRaceCard from "@/app/components/FeaturedRaceCard";
import PastRaceItem from "@/app/components/PastRaceItem";
import { LaneStatsBar, SlimeStatsTable } from "@/app/components/StatsPanel";
import {
  apiDeleteRace,
  apiGetSettings,
  apiListBanners,
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
import { AppSettings, Banner, DEFAULT_SETTINGS, Race } from "@/lib/types";
import { useCallback, useEffect, useMemo, useState } from "react";

type Props = {
  admin?: boolean;
  onLogout?: () => void;
};

export default function Dashboard({ admin = false, onLogout }: Props) {
  const [races, setRaces] = useState<Race[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(todayString());
  // 기본값을 '전체 보기'로 — 자정이 지나도 과거 기록이 사라지지 않음.
  // 관리자는 날짜 드롭다운으로 특정 일자만 필터 가능.
  const [showAll, setShowAll] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [r, s, bn] = await Promise.all([
        apiListRaces(),
        apiGetSettings(),
        apiListBanners(),
      ]);
      setRaces(r);
      setSettings(s);
      setBanners(bn);
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

      <BannerCarousel banners={banners} position="top" />

      {admin && (
        <header className="flex flex-wrap items-center justify-end gap-3 border-b border-white/8 pb-5">
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
          <button type="button" className="btn" onClick={onLogout}>
            로그아웃
          </button>
        </header>
      )}

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
          {admin && <AgentPanel />}
          {admin && (
            <BannerAdmin banners={banners} onChange={setBanners} />
          )}
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
                <div className="flex flex-col gap-4">
                  <FeaturedRaceCard
                    race={visibleRaces[0]}
                    readOnly={!admin}
                    onChange={admin ? handleChange : undefined}
                    onDelete={
                      admin ? () => handleDelete(visibleRaces[0].id) : undefined
                    }
                  />
                  {visibleRaces.length > 1 && (
                    <div className="past-list">
                      <div className="past-list-head">
                        지난 경기 결과
                        {visibleRaces.length - 1 > 20 && (
                          <span className="ml-2 text-zinc-600 normal-case tracking-normal">
                            (최근 20경기)
                          </span>
                        )}
                      </div>
                      {visibleRaces.slice(1, 21).map((r) => (
                        <PastRaceItem
                          key={r.id}
                          race={r}
                          admin={admin}
                          onChange={admin ? handleChange : undefined}
                          onDelete={
                            admin ? () => handleDelete(r.id) : undefined
                          }
                        />
                      ))}
                    </div>
                  )}
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

      <BannerCarousel banners={banners} position="bottom" />
    </main>
  );
}
