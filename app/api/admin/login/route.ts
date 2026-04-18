import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, ADMIN_PASSWORD, ADMIN_TOKEN } from "@/lib/admin";

export async function POST(req: NextRequest) {
  const { password } = (await req.json().catch(() => ({}))) as {
    password?: string;
  };
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json(
      { error: "비밀번호가 올바르지 않습니다." },
      { status: 401 }
    );
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, ADMIN_TOKEN, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
