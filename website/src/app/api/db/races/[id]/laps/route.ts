import { getLapSummaries } from "@server/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const laps = await getLapSummaries(id);
    return Response.json({ laps });
  } catch (err) {
    return Response.json(
      { error: `Failed to get laps: ${err}` },
      { status: 500 },
    );
  }
}
