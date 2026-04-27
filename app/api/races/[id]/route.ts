import { NextRequest, NextResponse } from "next/server";
import { deleteRace, listRaces, saveRace } from "@/lib/db";
import { isCanonicalSlimeName } from "@/lib/slimes";
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

  // 빈 칸은 허용. 입력된 이름은 공식 슬라임 목록에 있어야 함 (오타 차단).
  if (Array.isArray(patch.lanes)) {
    const invalid = patch.lanes
      .slice(0, LANE_COUNT)
      .map((l, i) => ({ name: String(l.slime ?? "").trim(), lane: i + 1 }))
      .filter((x) => x.name && !isCanonicalSlimeName(x.name));
    if (invalid.length) {
      return NextResponse.json(
        {
          error: `슬라임 이름 오타: ${invalid
            .map((x) => `${x.lane}레인 "${x.name}"`)
            .join(", ")}`,
        },
        { status: 400 }
      );
    }
  }

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
