import { NextRequest } from "next/server";

export const ADMIN_PASSWORD = "1234";
export const ADMIN_COOKIE = "slime_admin";
export const ADMIN_TOKEN = "ok-v1";

export function isAdminRequest(req: NextRequest): boolean {
  return req.cookies.get(ADMIN_COOKIE)?.value === ADMIN_TOKEN;
}
