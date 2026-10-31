import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { startFakeDAPServer, FakeDAPServer } from './helpers/fake-dap-server.js';
import { closedPort, readConsole, settle, startMCPServer } from './helpers/mcp-server.js';

// The server retries every 5 s; allow one full interval plus the handshake.
const RETRY_WINDOW_MS = 8000;

describe('MCP server DAP connection at startup', () => {
  let dap: FakeDAPServer | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    await dap?.close();
    client = undefined;
    dap = undefined;
  });

  it('captures output emitted before the first tool call', async () => {
    dap = await startFakeDAPServer();
    client = await startMCPServer(dap.port);

    await dap.waitForOpenCount((count) => count === 1);
    dap.broadcast({
      type: 'event',
      event: 'output',
      body: { category: 'stdout', output: 'scene started\n' },
    });
    await settle();

    const entries = await readConsole(client);

    assert.deepStrictEqual(
      entries.map((entry) => entry.message),
      ['scene started\n']
    );
  });

  it('connects once the debug adapter comes up after the server', async () => {
    const port = await closedPort();
    client = await startMCPServer(port);
    await settle(500);

    dap = await startFakeDAPServer({ port });

    await dap.waitForOpenCount((count) => count === 1, RETRY_WINDOW_MS);
  });

  it('reconnects after the debug adapter drops the connection', async () => {
    dap = await startFakeDAPServer();
    client = await startMCPServer(dap.port);
    await dap.waitForOpenCount((count) => count === 1);

    dap.dropConnections();
    await dap.waitForOpenCount((count) => count === 0);

    await dap.waitForOpenCount((count) => count === 1, RETRY_WINDOW_MS);
    assert.strictEqual(dap.acceptedCount(), 2);
  });

  it('reports runtime exceptions through get_console_output', async () => {
    dap = await startFakeDAPServer({
      responses: {
        stackTrace: () => ({
          success: true,
          body: {
            stackFrames: [
              { name: '_ready', line: 10, source: { name: 'probe.gd', path: '/project/probe.gd' } },
            ],
          },
        }),
      },
    });
    client = await startMCPServer(dap.port);
    await dap.waitForOpenCount((count) => count === 1);

    dap.broadcast({
      type: 'event',
      event: 'stopped',
      body: {
        reason: 'exception',
        description: 'Exception',
        text: "Cannot call method 'get_name' on a null value.",
        threadId: 1,
      },
    });
    await settle();

    const [entry] = await readConsole(client);

    assert.strictEqual(entry.category, 'stderr');
    assert.strictEqual(entry.message, "Cannot call method 'get_name' on a null value.");
    assert.strictEqual(entry.source, '/project/probe.gd');
    assert.strictEqual(entry.line, 10);
  });
});
