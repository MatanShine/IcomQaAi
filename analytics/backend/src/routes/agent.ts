import { Router } from 'express';

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://app:8000';

export const agentRouter = Router();

/**
 * Proxy SSE stream from the app's /chat/agent endpoint.
 * The frontend sends { message, session_id, open_ticket? } and receives
 * a server-sent event stream that is forwarded as-is.
 */
agentRouter.post('/chat', async (req, res) => {
  try {
    const appResponse = await fetch(`${APP_BASE_URL}/api/v1/chat/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });

    if (!appResponse.ok) {
      return res.status(appResponse.status).json({
        error: `App responded with ${appResponse.status}`,
      });
    }

    // Forward SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const reader = appResponse.body?.getReader();
    if (!reader) {
      res.end();
      return;
    }

    // Stream chunks from app to client
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    };

    // If client disconnects, cancel the reader
    req.on('close', () => {
      reader.cancel().catch(() => {});
    });

    await pump();
  } catch (error) {
    console.error('Failed to proxy agent chat:', error);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to reach app service for agent chat' });
    } else {
      res.end();
    }
  }
});
