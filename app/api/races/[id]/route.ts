import { NextRequest, NextResponse } from "next/server";
import { deleteRace, listRaces, saveRace } from "@/lib/db";
import { LANE_COUNT, Race } from "@/lib/types";
import { isAdminRequest } from "@/lib/admin";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const ok = await deleteRace(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const all = await listRaces();
  const cur = all.find((r) => r.id === id);
  if (!cur) return NextResponse.json({ error: "not found" }, { status: 404 });

  const patch = (await req.json()) as Partial<Race>;
  const next: Race = {
    ...cur,
    ...patch,
    id: cur.id,
    lanes: Array.isArray(patch.lanes)
      ? patch.lanes.slice(0, LANE_COUNT).map((l, i) => ({
          lane: i + 1,
          slime: String(l.slime ?? "").trim(),
          number: typeof l.number === "number" ? l.number : undefined,
        }))
      : cur.lanes,
    winnerLane:
      patch.winnerLane === null
        ? null
        : typeof patch.winnerLane === "number"
          ? patch.winnerLane
          : cur.winnerLane,
  };
  const saved = await saveRace(next);
  return NextResponse.json({ race: saved });
}
