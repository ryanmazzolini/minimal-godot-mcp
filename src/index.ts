#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { LSPClient } from './lsp-client.js';
import { LSPSession, getLSPIdleTimeoutMs } from './lsp-session.js';
import { DiagnosticsManager } from './diagnostics-manager.js';
import {
  getDiagnostics,
  getDiagnosticsTool,
  GetDiagnosticsInput,
} from './tools/get-diagnostics.js';
import {
  scanWorkspaceDiagnostics,
  scanWorkspaceDiagnosticsTool,
} from './tools/scan-workspace-diagnostics.js';
import { DAPClient } from './dap-client.js';
import { ConsoleManager } from './console-manager.js';
import { DAPOutputEventBody } from './types.js';
import {
  getConsoleOutput,
  getConsoleOutputTool,
  GetConsoleOutputInput,
} from './tools/get-console-output.js';
import {
  clearConsoleOutput,
  clearConsoleOutputTool,
} from './tools/clear-console-output.js';

/** Delay between background attempts to reach Godot's debug adapter */
const DAP_RETRY_INTERVAL_MS = 5000;

type DAPConnectMode = 'eager' | 'lazy';

/**
 * GODOT_DAP_CONNECT=lazy defers the DAP connection to the first
 * get_console_output call. That frees one of Godot's 8 debug adapter client
 * slots per idle server, but output emitted before the call is lost.
 */
function getDAPConnectMode(): DAPConnectMode {
  const value = process.env.GODOT_DAP_CONNECT;
  if (value === undefined || value === '' || value === 'eager') return 'eager';
  if (value === 'lazy') return 'lazy';
  console.error(`Invalid GODOT_DAP_CONNECT: ${value} (expected eager or lazy). Using eager.`);
  return 'eager';
}

/**
 * Main MCP server
 */
async function main(): Promise<void> {
  const lspClient = new LSPClient();
  const diagnosticsManager = new DiagnosticsManager(lspClient);
  const lspSession = new LSPSession(lspClient, getLSPIdleTimeoutMs());

  // DAP client for console output
  const dapClient = new DAPClient();
  const consoleManager = new ConsoleManager();
  let isDAPConnected = false;
  let dapConnecting: Promise<boolean> | null = null;

  // Set workspace path if provided
  const workspacePath = process.env.GODOT_WORKSPACE_PATH;
  if (workspacePath !== undefined && workspacePath !== '') {
    diagnosticsManager.setWorkspace(workspacePath);
  }

  // DAP connection helper (with lock to prevent concurrent connection attempts)
  const tryConnectDAP = async (): Promise<boolean> => {
    if (isDAPConnected) return true;
    if (dapConnecting) return dapConnecting;

    dapConnecting = (async (): Promise<boolean> => {
      try {
        await dapClient.connect();
        isDAPConnected = true;
        console.error('Connected to Godot DAP');
        return true;
      } catch {
        return false;
      }
    })();

    try {
      return await dapConnecting;
    } finally {
      dapConnecting = null;
    }
  };

  // Godot streams output live and never replays it, so the DAP connection has
  // to exist before the scene runs. Connect at startup and keep retrying while
  // Godot is not reachable, instead of waiting for the first tool call.
  let dapRetryTimer: NodeJS.Timeout | null = null;
  const scheduleDAPConnect = (): void => {
    if (dapRetryTimer || !dapClient.shouldReconnect()) return;
    dapRetryTimer = setTimeout(async () => {
      dapRetryTimer = null;
      if (!(await tryConnectDAP())) {
        scheduleDAPConnect();
      }
    }, DAP_RETRY_INTERVAL_MS);
  };

  // Set up DAP event handlers
  dapClient.on('output', (event: DAPOutputEventBody) => {
    consoleManager.addOutput(event);
  });

  const dapConnectMode = getDAPConnectMode();

  // Not awaited: a slow DAP handshake must not delay the MCP server start
  if (dapConnectMode === 'eager') {
    void tryConnectDAP().then((connected) => {
      if (!connected) {
        console.error('Godot DAP not reachable yet. Retrying in the background.');
        scheduleDAPConnect();
      }
    });
  }

  // Initialize MCP server
  const server = new Server(
    {
      name: 'minimal-godot-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      getDiagnosticsTool,
      scanWorkspaceDiagnosticsTool,
      getConsoleOutputTool,
      clearConsoleOutputTool,
    ],
  }));

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'get_diagnostics') {
      const input = args as unknown as GetDiagnosticsInput;
      const result = await lspSession.run((connected) =>
        getDiagnostics(diagnosticsManager, connected, input)
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'scan_workspace_diagnostics') {
      const result = await lspSession.run((connected) =>
        scanWorkspaceDiagnostics(diagnosticsManager, connected)
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_console_output') {
      // Connect now if Godot came up since the last background attempt
      await tryConnectDAP();

      const input = args as unknown as GetConsoleOutputInput;
      const result = getConsoleOutput(consoleManager, isDAPConnected, input);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'clear_console_output') {
      const result = clearConsoleOutput(consoleManager);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  // Handle errors
  server.onerror = (error): void => {
    console.error('MCP Server error:', error);
  };

  lspClient.on('close', () => {
    console.error('LSP connection closed. Will reconnect on the next diagnostics call.');
  });

  // Handle DAP events
  dapClient.on('close', () => {
    isDAPConnected = false;
    if (dapConnectMode === 'lazy') {
      console.error('DAP connection closed. Will reconnect on next get_console_output call.');
      return;
    }
    console.error('DAP connection closed. Reconnecting in the background.');
    scheduleDAPConnect();
  });

  // A terminated debug session does not end the DAP connection: Godot keeps
  // the socket open and streams the next run's output over it. Treating it
  // as a disconnect made the next tool call open a second socket.
  dapClient.on('terminated', () => {
    console.error('Debug session ended. Output of the next run will be captured.');
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Godot MCP server running');

  // Cleanup on exit
  let cleanupCalled = false;
  const cleanup = (signal: string): void => {
    if (cleanupCalled) return;
    cleanupCalled = true;

    console.error(`Shutting down (${signal})...`);

    lspSession.dispose();

    // Stop DAP reconnection loop
    if (dapRetryTimer) {
      clearTimeout(dapRetryTimer);
      dapRetryTimer = null;
    }

    // Disconnect clients
    lspClient.disconnect();
    dapClient.disconnect();

    console.error('Cleanup complete');
    process.exit(0);
  };

  // Register all cleanup handlers
  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('SIGTERM', () => cleanup('SIGTERM'));
  process.on('SIGHUP', () => cleanup('SIGHUP'));
  process.on('beforeExit', () => cleanup('beforeExit'));

  // Detect stdio close (Claude disconnect)
  process.stdin.on('close', () => cleanup('stdin-close'));
  process.stdout.on('close', () => cleanup('stdout-close'));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
