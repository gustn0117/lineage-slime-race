import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin";

export async function GET(req: NextRequest) {
  return NextResponse.json({ admin: isAdminRequest(req) });
}
