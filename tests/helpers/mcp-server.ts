import { createServer, AddressInfo } from 'net';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ConsoleOutput } from '../../src/types.js';

const serverEntry = fileURLToPath(new URL('../../src/index.ts', import.meta.url));

/** A port nothing listens on, so a connect to it fails fast. */
export async function closedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/**
 * Start the real MCP server as a child process, the way an MCP host does.
 * The LSP port points at a closed port so no running Godot is picked up.
 */
export async function startMCPServer(dapPort: number): Promise<Client> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.GODOT_DAP_PORT = String(dapPort);
  env.GODOT_LSP_PORT = String(await closedPort());

  const client = new Client({ name: 'minimal-godot-mcp-test', version: '0.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', serverEntry],
      env,
      stderr: 'ignore',
    })
  );
  return client;
}

export async function readConsole(client: Client): Promise<ConsoleOutput[]> {
  const result = await client.callTool({ name: 'get_console_output', arguments: {} });
  const content = result.content as { type: string; text: string }[];
  return (JSON.parse(content[0].text) as { entries: ConsoleOutput[] }).entries;
}

export async function settle(ms = 150): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
