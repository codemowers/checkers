/** A public transport check; it exposes no games, seats or authentication data. */
export function connectionEvents(request: Request, ping: () => Promise<unknown>) {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let checking = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      const stop = () => {
        closed = true;
        if (timer) clearInterval(timer);
        request.signal.removeEventListener("abort", finish);
      };
      const finish = () => { if (!closed) { stop(); controller.close(); } };
      cleanup = stop;
      const check = async () => {
        if (closed || checking) return;
        checking = true;
        try {
          await ping();
          if (!closed) controller.enqueue(encoder.encode('data: {"connected":true}\n\n'));
        } catch (error) {
          if (!closed) { stop(); controller.error(error); }
        } finally { checking = false; }
      };
      request.signal.addEventListener("abort", finish, { once: true });
      if (request.signal.aborted) { finish(); return; }
      timer = setInterval(() => void check(), 10000);
      void check();
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
