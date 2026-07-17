import { getPublicState, subscribe } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SSE replaces the old WebSocket /ws?match=<id> endpoint: the initial message
// and every subsequent one is the match's publicState as a JSON `data:` frame.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const initial = await getPublicState(id);
  if (!initial) return Response.json({ error: 'match not found' }, { status: 404 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (unsubscribe) unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed by the runtime
        }
      };

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // client went away without firing abort yet
          cleanup();
        }
      };

      // Current state immediately, then on every accepted event.
      write(`data: ${JSON.stringify(initial)}\n\n`);
      unsubscribe = subscribe(id, (state) => write(`data: ${JSON.stringify(state)}\n\n`));

      // Heartbeat comment keeps proxies/browsers from timing the stream out.
      heartbeat = setInterval(() => write(`: heartbeat\n\n`), 25_000);

      req.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
