import { listRaces } from "@server/db";

export async function GET() {
  try {
    const races = await listRaces();
    return Response.json({ races });
  } catch (err) {
    return Response.json(
      { error: `Failed to list races: ${err}` },
      { status: 500 },
    );
  }
}
