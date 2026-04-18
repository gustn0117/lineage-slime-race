import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
import { isAdminRequest } from "@/lib/admin";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ settings });
}

export async function PUT(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const patch: { recentWindow?: number } = {};
  if (typeof body.recentWindow === "number" && body.recentWindow > 0) {
    patch.recentWindow = Math.min(1000, Math.floor(body.recentWindow));
  }
  const settings = await saveSettings(patch);
  return NextResponse.json({ settings });
}
