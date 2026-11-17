import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { DAPClient } from '../src/dap-client.js';
import { DAPOutputEventBody } from '../src/types.js';
import {
  startFakeDAPServer,
  FakeDAPServer,
  FakeDAPServerOptions,
} from './helpers/fake-dap-server.js';

// Captured verbatim from Godot 4.7.2 on a null dereference
const exceptionStop = {
  type: 'event',
  event: 'stopped',
  body: {
    description: 'Exception',
    reason: 'exception',
    text: "Cannot call method 'get_name' on a null value.",
    threadId: 1,
  },
};

// Shape of Godot 4.7.2's stackTrace response for the stop above
const godotStackTrace = {
  success: true,
  body: {
    stackFrames: [
      {
        id: 0,
        name: '_ready',
        line: 10,
        column: 0,
        source: { name: 'probe.gd', path: 'C:/project/probe.gd' },
      },
    ],
  },
};

describe('DAP runtime exception capture', () => {
  let server: FakeDAPServer;
  let client: DAPClient;

  async function connectWith(options: FakeDAPServerOptions): Promise<DAPOutputEventBody[]> {
    server = await startFakeDAPServer(options);
    client = new DAPClient();
    await client.connect(server.port);
    const received: DAPOutputEventBody[] = [];
    client.on('output', (body: DAPOutputEventBody) => received.push(body));
    return received;
  }

  async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('condition not met in time');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  afterEach(async () => {
    client.disconnect();
    await server.close();
  });

  it('reports an exception stop as stderr output with file and line', async () => {
    const received = await connectWith({ responses: { stackTrace: () => godotStackTrace } });

    server.broadcast(exceptionStop);
    await waitFor(() => received.length === 1);

    assert.deepStrictEqual(received[0], {
      category: 'stderr',
      output: "Cannot call method 'get_name' on a null value.",
      source: { name: 'probe.gd', path: 'C:/project/probe.gd' },
      line: 10,
    });
  });

  it('asks for the stack of the stopped thread', async () => {
    const received = await connectWith({ responses: { stackTrace: () => godotStackTrace } });

    server.broadcast({ ...exceptionStop, body: { ...exceptionStop.body, threadId: 3 } });
    await waitFor(() => received.length === 1);

    const request = server.requests.find((entry) => entry.command === 'stackTrace');
    assert.deepStrictEqual(request?.arguments, { threadId: 3, levels: 1 });
  });

  it('keeps the message when the stack trace is refused', async () => {
    const received = await connectWith({
      responses: { stackTrace: () => ({ success: false, body: { error: 'not stopped' } }) },
    });

    server.broadcast(exceptionStop);
    await waitFor(() => received.length === 1);

    assert.deepStrictEqual(received[0], {
      category: 'stderr',
      output: "Cannot call method 'get_name' on a null value.",
    });
  });

  it('reports the message after a timeout when the stack trace never arrives', async () => {
    const received = await connectWith({ responses: { stackTrace: () => undefined } });

    server.broadcast(exceptionStop);
    await waitFor(() => received.length === 1, 4000);

    assert.strictEqual(received[0].category, 'stderr');
    assert.strictEqual(received[0].line, undefined);
  });

  it('falls back to the description when Godot sends no text', async () => {
    const received = await connectWith({ responses: { stackTrace: () => godotStackTrace } });

    server.broadcast({
      type: 'event',
      event: 'stopped',
      body: { reason: 'exception', description: 'Exception', threadId: 1 },
    });
    await waitFor(() => received.length === 1);

    assert.strictEqual(received[0].output, 'Exception');
  });

  it('ignores stops that are not exceptions', async () => {
    const received = await connectWith({ responses: { stackTrace: () => godotStackTrace } });

    for (const reason of ['breakpoint', 'step', 'pause']) {
      server.broadcast({ type: 'event', event: 'stopped', body: { reason, threadId: 1 } });
    }
    server.broadcast({
      type: 'event',
      event: 'output',
      body: { category: 'stdout', output: 'marker' },
    });
    await waitFor(() => received.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepStrictEqual(
      received.map((body) => body.output),
      ['marker']
    );
    assert.strictEqual(
      server.requests.some((entry) => entry.command === 'stackTrace'),
      false
    );
  });
});
