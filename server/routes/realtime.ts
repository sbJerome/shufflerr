// Mounted at /api/v1/realtime (see docs/API_CONTRACT.md). A Server-Sent Events
// stream: the browser opens one connection and receives request/media/scan
// updates as they happen, instead of polling.
import type { RealtimeEvent } from '@server/lib/realtime';
import { isEventVisibleTo, onRealtimeEvent } from '@server/lib/realtime';
import { Router } from 'express';

const router = Router();

// Keep intermediaries (Cloudflare tunnel, proxies) from closing an idle stream.
const HEARTBEAT_MS = 25000;

router.get('/', (req, res) => {
  const viewer = req.user;
  if (!viewer) {
    res.status(403).json({
      status: 403,
      error: 'You do not have permission to access this endpoint',
    });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disable proxy buffering so events are delivered immediately.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  // Tell the browser how long to wait before reconnecting, and open the stream.
  res.write('retry: 5000\n\n');
  res.write(': connected\n\n');

  const send = (event: RealtimeEvent): void => {
    if (res.writableEnded || !isEventVisibleTo(viewer, event)) {
      return;
    }
    try {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    } catch {
      // The socket went away between the check and the write; close() cleans up.
    }
  };

  const unsubscribe = onRealtimeEvent(send);

  const heartbeat = setInterval(() => {
    if (res.writableEnded) {
      return;
    }
    try {
      res.write(': ping\n\n');
    } catch {
      /* closed */
    }
  }, HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    if (!res.writableEnded) {
      res.end();
    }
  });
});

export default router;
