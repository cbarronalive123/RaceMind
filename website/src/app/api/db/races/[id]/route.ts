import { getRaceById } from "@server/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const race = await getRaceById(id);
    if (!race) {
      return Response.json({ error: `race not found: ${id}` }, { status: 404 });
    }
    return Response.json({ race });
  } catch (err) {
    return Response.json(
      { error: `Failed to get race: ${err}` },
      { status: 500 },
    );
  }
}
