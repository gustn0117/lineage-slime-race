import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.INGEST_TOKEN ?? "";
  const configured = token.length > 0;
  return NextResponse.json({ token, configured });
}
