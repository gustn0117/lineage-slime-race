// 저장소 추상화 레이어
// 현재는 JSON 파일 기반. 추후 DB(Postgres/SQLite 등)로 교체하려면
// 이 파일의 구현만 바꾸면 됨.

import { promises as fs } from "fs";
import path from "path";
import {
  AppSettings,
  DEFAULT_SETTINGS,
  Race,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const RACES_FILE = path.join(DATA_DIR, "races.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

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

export async function listRaces(): Promise<Race[]> {
  const races = await readJson<Race[]>(RACES_FILE, []);
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
