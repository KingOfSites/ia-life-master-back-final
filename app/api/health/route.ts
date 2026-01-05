import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "ia-life-backend",
    timestamp: new Date().toISOString(),
  })
}
