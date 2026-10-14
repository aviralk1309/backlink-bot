import { NextResponse } from "next/server";
import { getJobLive } from "@/features/jobs/queries";
import { jobIdSchema } from "@/features/jobs/schemas";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!jobIdSchema.safeParse(id).success) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  try {
    const live = await getJobLive(id);
    // Missing and hidden-by-RLS look the same on purpose.
    if (!live) {
      return NextResponse.json(
        { error: "not_found" },
        { status: 404, headers: NO_STORE },
      );
    }
    return NextResponse.json(live, { headers: NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "unavailable" },
      { status: 500, headers: NO_STORE },
    );
  }
}
