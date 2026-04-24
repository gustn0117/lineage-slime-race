import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin";
import { listBanners, saveBanner } from "@/lib/db";
import { Banner } from "@/lib/types";

export async function GET() {
  const banners = await listBanners();
  return NextResponse.json({ banners });
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json()) as Partial<Banner>;
  if (!body.imageUrl) {
    return NextResponse.json(
      { error: "imageUrl은 필수입니다." },
      { status: 400 }
    );
  }
  const existing = await listBanners();
  const nextOrder = existing.length
    ? Math.max(...existing.map((b) => b.order)) + 1
    : 0;
  const banner: Banner = {
    id: body.id ?? makeId(),
    imageUrl: String(body.imageUrl).trim(),
    linkUrl: body.linkUrl ? String(body.linkUrl).trim() : undefined,
    title: body.title ? String(body.title).trim() : undefined,
    enabled: body.enabled !== false,
    order: typeof body.order === "number" ? body.order : nextOrder,
    createdAt: body.createdAt ?? Date.now(),
  };
  const saved = await saveBanner(banner);
  return NextResponse.json({ banner: saved });
}
