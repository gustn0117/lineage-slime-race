// 클라이언트용 API 래퍼

import { AppSettings, Banner, Race } from "./types";

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

export async function apiAdminStatus(): Promise<boolean> {
  const { admin } = await handle<{ admin: boolean }>(
    await fetch("/api/admin/status", { cache: "no-store" })
  );
  return admin;
}

export async function apiAdminLogin(password: string): Promise<void> {
  await handle<{ ok: true }>(
    await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    })
  );
}

export async function apiAdminLogout(): Promise<void> {
  await handle<{ ok: true }>(
    await fetch("/api/admin/logout", { method: "POST" })
  );
}

export async function apiListBanners(): Promise<Banner[]> {
  const { banners } = await handle<{ banners: Banner[] }>(
    await fetch("/api/banners", { cache: "no-store" })
  );
  return banners;
}

export async function apiSaveBanner(
  banner: Partial<Banner>
): Promise<Banner> {
  const { banner: saved } = await handle<{ banner: Banner }>(
    await fetch("/api/banners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(banner),
    })
  );
  return saved;
}

export async function apiPatchBanner(
  id: string,
  patch: Partial<Banner>
): Promise<Banner> {
  const { banner } = await handle<{ banner: Banner }>(
    await fetch(`/api/banners/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  );
  return banner;
}

export async function apiDeleteBanner(id: string): Promise<void> {
  await handle<{ ok: true }>(
    await fetch(`/api/banners/${id}`, { method: "DELETE" })
  );
}

export async function apiUploadBannerImage(file: File): Promise<{
  url: string;
  path: string;
}> {
  const fd = new FormData();
  fd.append("file", file);
  return handle<{ url: string; path: string }>(
    await fetch("/api/banners/upload", { method: "POST", body: fd })
  );
}

export async function apiGetIngestToken(): Promise<{
  token: string;
  configured: boolean;
}> {
  return handle<{ token: string; configured: boolean }>(
    await fetch("/api/admin/ingest-token", { cache: "no-store" })
  );
}
