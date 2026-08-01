import { getAgentMessages } from "@server/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const messages = await getAgentMessages(id);
    return Response.json({ messages });
  } catch (err) {
    return Response.json(
      { error: `Failed to get messages: ${err}` },
      { status: 500 },
    );
  }
}
