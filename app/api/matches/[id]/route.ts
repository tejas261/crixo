import { getPublicState } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = await getPublicState(id);
  if (!state) return Response.json({ error: 'match not found' }, { status: 404 });
  return Response.json({ ...state, id });
}
