import { getTelemetryFrames } from "@server/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "1000");
  try {
    const frames = await getTelemetryFrames(id, Math.min(limit, 10000));
    return Response.json({ frames, count: frames.length });
  } catch (err) {
    return Response.json(
      { error: `Failed to get telemetry: ${err}` },
      { status: 500 },
    );
  }
}
