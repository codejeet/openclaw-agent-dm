import type { WebSocketServer, WebSocket } from 'ws';

export type StreamEvent =
  | { type: 'message.new'; message: unknown }
  | { type: 'contact.new'; contact: unknown }
  | { type: 'message.status'; id: string; status: string };

export function makeBroadcaster(wss: WebSocketServer) {
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  });

  return (evt: StreamEvent) => {
    const msg = JSON.stringify(evt);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  };
}
