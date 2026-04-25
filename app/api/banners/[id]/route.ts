import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin";
import { deleteBanner, listBanners, saveBanner } from "@/lib/db";
import { deleteBannerImage, extractPath } from "@/lib/storage";
import { Banner, BannerSlot } from "@/lib/types";

const VALID_SLOTS: BannerSlot[] = ["top-1", "top-2", "bottom"];

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const all = await listBanners();
  const cur = all.find((b) => b.id === id);
  if (!cur) return NextResponse.json({ error: "not found" }, { status: 404 });

  const patch = (await req.json()) as Partial<Banner>;
  const next: Banner = {
    ...cur,
    ...patch,
    id: cur.id,
    imageUrl:
      typeof patch.imageUrl === "string"
        ? patch.imageUrl.trim()
        : cur.imageUrl,
    linkUrl:
      patch.linkUrl === undefined
        ? cur.linkUrl
        : patch.linkUrl === ""
          ? undefined
          : String(patch.linkUrl).trim(),
    title:
      patch.title === undefined
        ? cur.title
        : patch.title === ""
          ? undefined
          : String(patch.title).trim(),
    enabled:
      typeof patch.enabled === "boolean" ? patch.enabled : cur.enabled,
    order:
      typeof patch.order === "number" ? patch.order : cur.order,
    slot: VALID_SLOTS.includes(patch.slot as BannerSlot)
      ? (patch.slot as BannerSlot)
      : (cur.slot ?? "top-1"),
  };
  const saved = await saveBanner(next);
  return NextResponse.json({ banner: saved });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const all = await listBanners();
  const target = all.find((b) => b.id === id);
  const ok = await deleteBanner(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (target?.imageUrl) {
    const path = extractPath(target.imageUrl);
    if (path) {
      deleteBannerImage(path).catch(() => {
        /* 파일 삭제 실패는 무시 — 레코드만 제거되어도 OK */
      });
    }
  }
  return NextResponse.json({ ok: true });
}
