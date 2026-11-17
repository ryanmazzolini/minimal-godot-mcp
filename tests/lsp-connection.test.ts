import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer, Socket } from 'node:net';
import { setImmediate } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LSPClient } from '../src/lsp-client.js';

function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

async function fixture(t: TestContext) {
  const events = new EventEmitter();
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => {});
    let buffer = Buffer.alloc(0);
    socket.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      while (true) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const match = /Content-Length: (\d+)/.exec(buffer.subarray(0, end).toString());
        assert.ok(match);
        const bodyEnd = end + 4 + Number(match[1]);
        if (buffer.length < bodyEnd) return;
        const message = JSON.parse(buffer.subarray(end + 4, bodyEnd).toString()) as { method: string };
        buffer = buffer.subarray(bodyEnd);
        events.emit(message.method, socket);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const port = address.port;
  const savedPort = process.env.GODOT_LSP_PORT;
  process.env.GODOT_LSP_PORT = String(port);
  const client = new LSPClient();
  t.after(async () => {
    client.disconnect();
    if (savedPort === undefined) delete process.env.GODOT_LSP_PORT;
    else process.env.GODOT_LSP_PORT = savedPort;
    for (const socket of sockets) socket.destroy();
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
  return { client, server, events, sockets, port };
}

function initialized(events: EventEmitter): Promise<unknown[]> {
  return once(events, 'initialized', { signal: AbortSignal.timeout(12000) });
}

function accept(socket: Socket): void {
  socket.write(frame({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }));
}

describe('LSP connection readiness', { timeout: 15000 }, () => {
  it('uses only port 6005 by default and bounds a stalled TCP connection', async (t) => {
    const savedPort = process.env.GODOT_LSP_PORT;
    delete process.env.GODOT_LSP_PORT;
    t.after(() => {
      if (savedPort !== undefined) process.env.GODOT_LSP_PORT = savedPort;
    });
    const ports: unknown[] = [];
    let socket: Socket | undefined;
    t.mock.method(Socket.prototype, 'connect', function (this: Socket, port: unknown) {
      ports.push(port);
      socket = this;
      return this;
    });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const client = new LSPClient();
    t.after(() => client.disconnect());
    const rejected = assert.rejects(client.connect(), /timed out/);
    t.mock.timers.tick(5000);
    await rejected;
    assert.deepEqual(ports, [6005]);
    assert.equal(socket?.destroyed, true);
  });

  it('waits for a valid initialize response, then sends initialized once', async (t) => {
    const { client, events, sockets } = await fixture(t);
    const request = once(events, 'initialize');
    let ready = false;
    const connecting = client.connect().then(() => { ready = true; });
    await request;
    await setImmediate();
    assert.equal(ready, false);
    const notification = initialized(events);
    accept(sockets[0]);
    await connecting;
    await notification;
    await client.connect();
    assert.equal(sockets.length, 1);
  });

  it('shares an in-flight connection between callers', async (t) => {
    const { client, events, sockets } = await fixture(t);
    const request = once(events, 'initialize');
    const attempts = [client.connect(), client.connect(), client.connect()];
    await request;
    accept(sockets[0]);
    await Promise.all(attempts);
    assert.equal(sockets.length, 1);
  });

  for (const response of [
    { error: { code: -32603, message: 'Rejected' } },
    { result: {} },
    { result: { capabilities: null } },
  ]) {
    it(`rejects initialization and releases the socket: ${JSON.stringify(response)}`, async (t) => {
      const { client, events, sockets } = await fixture(t);
      events.on('initialize', (socket: Socket) => {
        socket.write(frame({ jsonrpc: '2.0', id: 1, ...response }));
      });
      let closeEvents = 0;
      client.on('close', () => { closeEvents++; });
      await assert.rejects(client.connect(), /initializ/);
      const socket = sockets[0];
      if (!socket.destroyed) await once(socket, 'close');
      assert.equal(closeEvents, 0, 'failed attempts must not look like established connection loss');
    });
  }

  it('times out and releases a TCP peer that never answers initialize', async (t) => {
    const { client, events, sockets } = await fixture(t);
    const request = once(events, 'initialize');
    const rejected = assert.rejects(client.connect(), /timed out/);
    await request;
    await rejected;
    if (!sockets[0].destroyed) await once(sockets[0], 'close');
  });

  it('rejects a peer that closes before initialization completes', async (t) => {
    const { client, events } = await fixture(t);
    events.on('initialize', (socket: Socket) => socket.end());
    await assert.rejects(client.connect(), /closed during initialization/);
  });

  it('notifies established socket loss, and discards partial data before reconnecting', async (t) => {
    const { client, events, sockets } = await fixture(t);
    events.on('initialize', accept);
    await client.connect();
    const closed = once(client, 'close');
    sockets[0].end('Content-Length: 100\r\n\r\n{"old":');
    await closed;
    const notification = initialized(events);
    await client.connect();
    await notification;
    assert.equal(sockets.length, 2);
  });

  it('still emits close after an established TCP reset', async (t) => {
    const { client, events, sockets } = await fixture(t);
    events.on('initialize', accept);
    await client.connect();
    const closed = once(client, 'close');
    sockets[0].resetAndDestroy();
    await closed;
    assert.equal(client.shouldReconnect(), true);
    await client.connect();
    assert.equal(sockets.length, 2);
  });

  it('cancels initialization on shutdown and refuses subsequent connections', async (t) => {
    const { client, events } = await fixture(t);
    const request = once(events, 'initialize');
    const rejected = assert.rejects(client.connect(), /disconnected during initialization/);
    await request;
    client.disconnect();
    await rejected;
    await assert.rejects(client.connect(), /shut down/);
    assert.equal(client.shouldReconnect(), false);
  });
});

async function mcpClient(t: TestContext, port: number) {
  const workspace = await mkdtemp(join(tmpdir(), 'godot-lsp-readiness-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/index.ts'],
    env: { GODOT_LSP_PORT: String(port), GODOT_WORKSPACE_PATH: workspace },
    stderr: 'pipe',
  });
  const logs = new EventEmitter();
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
    logs.emit('data');
  });
  const logContaining = async (text: string): Promise<void> => {
    while (!stderr.includes(text)) {
      await once(logs, 'data', { signal: AbortSignal.timeout(12000) });
    }
  };
  const client = new Client({ name: 'lsp-readiness-test', version: '1.0' });
  t.after(async () => {
    await client.close();
    await rm(workspace, { recursive: true, force: true });
  });
  await client.connect(transport, { timeout: 2000 });
  const scan = async (): Promise<Record<string, unknown>> => {
    const response = await client.callTool({ name: 'scan_workspace_diagnostics', arguments: {} });
    const content = response.content as { type: string; text: string }[];
    return JSON.parse(content[0].text) as Record<string, unknown>;
  };
  return { client, scan, logContaining, getStderr: () => stderr };
}

describe('MCP startup and LSP recovery', { timeout: 20000 }, () => {
  it('serves MCP while initialize is pending, and gates diagnostics until ready', async (t) => {
    const { events, port } = await fixture(t);
    const request = once(events, 'initialize');
    const { client, scan } = await mcpClient(t, port);
    const [socket] = await request as [Socket];
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 4);
    assert.equal(typeof (await scan()).error, 'string');
    const notification = initialized(events);
    accept(socket);
    await notification;
    assert.equal((await scan()).error, undefined);
  });

  it('recovers from initial refusal and an established reset without duplicate connections', async (t) => {
    const { server, events, sockets, port } = await fixture(t);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    events.on('initialize', accept);
    const { scan, logContaining, getStderr } = await mcpClient(t, port);
    await logContaining('Godot LSP unavailable:');
    assert.match(getStderr(), /Godot LSP unavailable: [^\n]+Retrying every 5 seconds\./);
    assert.equal(typeof (await scan()).error, 'string');
    const first = initialized(events);
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    await first;
    assert.equal((await scan()).error, undefined);
    const second = initialized(events);
    sockets[0].resetAndDestroy();
    await logContaining('LSP connection closed.');
    assert.equal(typeof (await scan()).error, 'string');
    await second;
    assert.equal((await scan()).error, undefined);
    assert.equal(sockets.length, 2);
  });
});
