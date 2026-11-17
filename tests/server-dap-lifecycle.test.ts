import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { startFakeDAPServer, FakeDAPServer } from './helpers/fake-dap-server.js';
import { readConsole, settle, startMCPServer } from './helpers/mcp-server.js';

describe('MCP server DAP connection across debug sessions', () => {
  let dap: FakeDAPServer;
  let client: Client;

  before(async () => {
    dap = await startFakeDAPServer();
    client = await startMCPServer(dap.port);
  });

  after(async () => {
    await client.close();
    await dap.close();
  });

  it('reuses one DAP connection for the next run after terminated', async () => {
    await readConsole(client);
    await dap.waitForOpenCount((count) => count === 1);

    dap.broadcast({ type: 'event', event: 'terminated' });
    await settle();
    dap.broadcast({
      type: 'event',
      event: 'output',
      body: { category: 'stdout', output: 'second run\n' },
    });
    await settle();

    const entries = await readConsole(client);

    assert.strictEqual(dap.acceptedCount(), 1, 'terminated must not trigger a reconnect');
    assert.strictEqual(dap.openCount(), 1);
    assert.deepStrictEqual(
      entries.map((entry) => entry.message),
      ['second run\n']
    );
  });
});
