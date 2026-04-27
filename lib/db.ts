// 저장소 추상화 레이어
// 현재는 JSON 파일 기반. 추후 DB(Postgres/SQLite 등)로 교체하려면
// 이 파일의 구현만 바꾸면 됨.

import { promises as fs } from "fs";
import path from "path";
import {
  AppSettings,
  Banner,
  DEFAULT_SETTINGS,
  Race,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const RACES_FILE = path.join(DATA_DIR, "races.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const BANNERS_FILE = path.join(DATA_DIR, "banners.json");

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const buf = await fs.readFile(file, "utf-8");
    return JSON.parse(buf) as T;
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "ENOENT"
    ) {
      return fallback;
    }
    throw e;
  }
}

async function writeJson(file: string, data: unknown) {
  await ensureDir();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

// 알려진 오타 → 공식 이름. 프로세스 첫 listRaces() 호출 시 한 번만 races.json
// 을 정리. 이후 호출은 already-clean 이라 no-op. saveRace 가 fix 결과를 영구화.
const SLIME_TYPO_MAP: Record<string, string> = {
  슈퍼블래: "슈퍼블랙",
  팰컨: "펠컨",
};
let typoMigrationDone = false;

async function migrateSlimeTypos(races: Race[]): Promise<Race[]> {
  if (typoMigrationDone) return races;
  typoMigrationDone = true;

  let fixed = 0;
  for (const r of races) {
    for (const l of r.lanes ?? []) {
      const s = (l.slime ?? "").trim();
      const canonical = SLIME_TYPO_MAP[s];
      if (canonical) {
        l.slime = canonical;
        fixed++;
      }
    }
  }
  if (fixed > 0) {
    await writeJson(RACES_FILE, races);
    console.log(`[migrate] slime typo 정정 ${fixed}건 적용`);
  }
  return races;
}

export async function listRaces(): Promise<Race[]> {
  let races = await readJson<Race[]>(RACES_FILE, []);
  races = await migrateSlimeTypos(races);
  return [...races].sort((a, b) => {
    const aKey = `${a.date} ${a.time}`;
    const bKey = `${b.date} ${b.time}`;
    return aKey.localeCompare(bKey);
  });
}

export async function saveRace(race: Race): Promise<Race> {
  const all = await listRaces();
  const idx = all.findIndex((r) => r.id === race.id);
  if (idx >= 0) all[idx] = race;
  else all.push(race);
  await writeJson(RACES_FILE, all);
  return race;
}

export async function deleteRace(id: string): Promise<boolean> {
  const all = await listRaces();
  const next = all.filter((r) => r.id !== id);
  if (next.length === all.length) return false;
  await writeJson(RACES_FILE, next);
  return true;
}

export async function getSettings(): Promise<AppSettings> {
  const s = await readJson<AppSettings>(SETTINGS_FILE, DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function saveSettings(
  patch: Partial<AppSettings>
): Promise<AppSettings> {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await writeJson(SETTINGS_FILE, next);
  return next;
}

export async function listBanners(): Promise<Banner[]> {
  const banners = await readJson<Banner[]>(BANNERS_FILE, []);
  return [...banners].sort((a, b) => a.order - b.order);
}

export async function saveBanner(banner: Banner): Promise<Banner> {
  const all = await listBanners();
  const idx = all.findIndex((b) => b.id === banner.id);
  if (idx >= 0) all[idx] = banner;
  else all.push(banner);
  await writeJson(BANNERS_FILE, all);
  return banner;
}

export async function deleteBanner(id: string): Promise<boolean> {
  const all = await listBanners();
  const next = all.filter((b) => b.id !== id);
  if (next.length === all.length) return false;
  await writeJson(BANNERS_FILE, next);
  return true;
}
