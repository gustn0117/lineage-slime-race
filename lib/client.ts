// 클라이언트용 API 래퍼

import { AppSettings, Race } from "./types";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function apiListRaces(): Promise<Race[]> {
  const { races } = await handle<{ races: Race[] }>(
    await fetch("/api/races", { cache: "no-store" })
  );
  return races;
}

export async function apiSaveRace(race: Partial<Race>): Promise<Race> {
  const { race: saved } = await handle<{ race: Race }>(
    await fetch("/api/races", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(race),
    })
  );
  return saved;
}

export async function apiPatchRace(
  id: string,
  patch: Partial<Race>
): Promise<Race> {
  const { race } = await handle<{ race: Race }>(
    await fetch(`/api/races/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  );
  return race;
}

export async function apiDeleteRace(id: string): Promise<void> {
  await handle<{ ok: true }>(
    await fetch(`/api/races/${id}`, { method: "DELETE" })
  );
}

export async function apiGetSettings(): Promise<AppSettings> {
  const { settings } = await handle<{ settings: AppSettings }>(
    await fetch("/api/settings", { cache: "no-store" })
  );
  return settings;
}

export async function apiSaveSettings(
  patch: Partial<AppSettings>
): Promise<AppSettings> {
  const { settings } = await handle<{ settings: AppSettings }>(
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  );
  return settings;
}
