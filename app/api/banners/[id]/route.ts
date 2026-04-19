import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin";
import { deleteBanner, listBanners, saveBanner } from "@/lib/db";
import { Banner } from "@/lib/types";

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
  const ok = await deleteBanner(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
