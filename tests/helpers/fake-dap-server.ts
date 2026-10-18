import { createServer, Server, Socket, AddressInfo } from 'net';

export interface FakeDAPServer {
  port: number;
  /** Connections the server still considers open */
  openCount(): number;
  /** Connections accepted since the server started, including closed ones */
  acceptedCount(): number;
  /** Send a DAP message to every open connection */
  broadcast(message: Record<string, unknown>): void;
  /** Every request received, in order */
  requests: { command: string; arguments?: unknown }[];
  /** Resolves once openCount() satisfies the predicate, rejects after timeoutMs */
  waitForOpenCount(predicate: (count: number) => boolean, timeoutMs?: number): Promise<void>;
  /** Close every open connection but keep listening, like a restarted debug adapter */
  dropConnections(): void;
  close(): Promise<void>;
}

export interface FakeDAPServerOptions {
  /** Listen on this port instead of a random free one */
  port?: number;
  /** Answer initialize with success: false instead of the capabilities */
  failInitialize?: boolean;
  /** Custom responses for other requests, keyed by command; undefined sends no reply */
  responses?: Record<string, (args: unknown) => { success: boolean; body?: unknown } | undefined>;
}

function frame(message: Record<string, unknown>): string {
  const content = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;
}

/**
 * Minimal stand-in for Godot's debug adapter. Mirrors what Godot 4.7 does
 * with no game running: initialize succeeds, attach fails with not_running.
 */
export async function startFakeDAPServer(
  options: FakeDAPServerOptions = {}
): Promise<FakeDAPServer> {
  const sockets = new Set<Socket>();
  const requests: { command: string; arguments?: unknown }[] = [];
  let accepted = 0;
  let seq = 1;

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    accepted++;
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));

    let buffer = '';
    socket.on('data', (data) => {
      buffer += data.toString();
      for (;;) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const match = /Content-Length: (\d+)/.exec(buffer.slice(0, headerEnd));
        if (!match) return;
        const end = headerEnd + 4 + parseInt(match[1], 10);
        if (buffer.length < end) return;
        const message = JSON.parse(buffer.slice(headerEnd + 4, end)) as {
          seq: number;
          type: string;
          command?: string;
          arguments?: unknown;
        };
        buffer = buffer.slice(end);
        if (message.type !== 'request' || message.command === undefined) continue;
        requests.push({ command: message.command, arguments: message.arguments });

        const reply = (success: boolean, body?: unknown): void => {
          socket.write(
            frame({
              seq: seq++,
              type: 'response',
              request_seq: message.seq,
              command: message.command,
              success,
              body,
            })
          );
        };

        const custom = options.responses?.[message.command];
        if (custom) {
          const result = custom(message.arguments);
          if (result) reply(result.success, result.body);
        } else if (message.command === 'initialize') {
          reply(!options.failInitialize, options.failInitialize ? { error: 'refused' } : {});
        } else if (message.command === 'attach') {
          reply(false, {
            error: { format: "Can't attach to a running session since there isn't one." },
          });
        } else {
          reply(false, { error: 'unsupported' });
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    openCount: () => sockets.size,
    acceptedCount: () => accepted,
    requests,
    broadcast: (message) => {
      for (const socket of sockets) {
        socket.write(frame({ seq: seq++, ...message }));
      }
    },
    waitForOpenCount: async (predicate, timeoutMs = 2000) => {
      const deadline = Date.now() + timeoutMs;
      while (!predicate(sockets.size)) {
        if (Date.now() > deadline) {
          throw new Error(`open connection count stayed at ${sockets.size}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    dropConnections: () => {
      for (const socket of sockets) {
        socket.destroy();
      }
    },
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
