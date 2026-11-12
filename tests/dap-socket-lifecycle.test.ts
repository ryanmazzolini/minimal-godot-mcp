import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { DAPClient } from '../src/dap-client.js';
import { startFakeDAPServer, FakeDAPServer } from './helpers/fake-dap-server.js';

const outputEvent = (text: string): Record<string, unknown> => ({
  type: 'event',
  event: 'output',
  body: { category: 'stdout', output: text },
});

const terminatedEvent = { type: 'event', event: 'terminated' };

async function nextTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('DAP socket lifecycle', () => {
  let server: FakeDAPServer;
  let client: DAPClient;

  beforeEach(async () => {
    server = await startFakeDAPServer();
    client = new DAPClient();
  });

  afterEach(async () => {
    client.disconnect();
    await server.close();
  });

  it('keeps a single connection open after connecting', async () => {
    await client.connect(server.port);

    await server.waitForOpenCount((count) => count === 1);
    assert.strictEqual(client.isConnected(), true);
  });

  it('stays connected across a terminated debug session', async () => {
    await client.connect(server.port);
    const received: string[] = [];
    client.on('output', (body: { output: string }) => received.push(body.output));

    server.broadcast(terminatedEvent);
    await nextTick();
    server.broadcast(outputEvent('second run'));
    await nextTick();

    assert.strictEqual(client.isConnected(), true);
    assert.deepStrictEqual(received, ['second run']);
    assert.strictEqual(server.openCount(), 1);
  });

  it('closes the previous socket when connect() is called again', async () => {
    await client.connect(server.port);
    await server.waitForOpenCount((count) => count === 1);

    await client.connect(server.port);

    await server.waitForOpenCount((count) => count === 1);
  });

  it('does not accumulate sockets over repeated terminate/reconnect cycles', async () => {
    for (let cycle = 0; cycle < 5; cycle++) {
      await client.connect(server.port);
      server.broadcast(terminatedEvent);
      await nextTick();
    }

    await server.waitForOpenCount((count) => count === 1);
  });

  it('delivers each output event once after a reconnect', async () => {
    await client.connect(server.port);
    server.broadcast(terminatedEvent);
    await client.connect(server.port);
    await server.waitForOpenCount((count) => count === 1);

    const received: string[] = [];
    client.on('output', (body: { output: string }) => received.push(body.output));
    server.broadcast(outputEvent('printed once'));
    await nextTick();

    assert.deepStrictEqual(received, ['printed once']);
  });

  it('does not emit close for a socket it replaced itself', async () => {
    await client.connect(server.port);
    let closes = 0;
    client.on('close', () => closes++);

    await client.connect(server.port);
    await nextTick();

    assert.strictEqual(closes, 0);
  });

  it('still emits close when the server drops the connection', async () => {
    await client.connect(server.port);
    const closed = new Promise<void>((resolve) => client.once('close', resolve));

    await server.close();
    await closed;

    assert.strictEqual(client.isConnected(), false);
    server = await startFakeDAPServer();
  });

  it('closes the socket when disconnect() is called', async () => {
    await client.connect(server.port);
    await server.waitForOpenCount((count) => count === 1);

    client.disconnect();

    await server.waitForOpenCount((count) => count === 0);
  });
});

describe('DAP connection failures', () => {
  it('destroys the socket when initialize is rejected', async () => {
    const server = await startFakeDAPServer({ failInitialize: true });
    const client = new DAPClient();
    try {
      await assert.rejects(client.connect(server.port), /Could not connect to Godot DAP/);

      assert.strictEqual(client.isConnected(), false);
      await server.waitForOpenCount((count) => count === 0);
    } finally {
      client.disconnect();
      await server.close();
    }
  });

  it('can connect after a failed attempt', async () => {
    const refusing = await startFakeDAPServer({ failInitialize: true });
    const accepting = await startFakeDAPServer();
    const client = new DAPClient();
    try {
      await assert.rejects(client.connect(refusing.port));
      await client.connect(accepting.port);

      assert.strictEqual(client.isConnected(), true);
      await refusing.waitForOpenCount((count) => count === 0);
      await accepting.waitForOpenCount((count) => count === 1);
    } finally {
      client.disconnect();
      await refusing.close();
      await accepting.close();
    }
  });
});
