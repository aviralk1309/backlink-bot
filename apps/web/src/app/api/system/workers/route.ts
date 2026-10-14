import { NextResponse } from "next/server";
import { listWorkerBeats } from "@/features/health/queries";
import { classifyWorkers } from "@/features/health/workers";
import { AuthError, requirePermission } from "@/lib/auth/session";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    await requirePermission("system.view_health");
    const beats = await listWorkerBeats();
    return NextResponse.json(classifyWorkers(beats, Date.now()), {
      headers: NO_STORE,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json(
        { error: e.code },
        { status: e.code === "unauthenticated" ? 401 : 403, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { error: "unavailable" },
      { status: 500, headers: NO_STORE },
    );
  }
}
