#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { LSPClient } from './lsp-client.js';
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

/**
 * Main MCP server
 */
async function main(): Promise<void> {
  // Initialize LSP client (don't connect yet)
  const lspClient = new LSPClient();
  const diagnosticsManager = new DiagnosticsManager(lspClient);
  let isConnected = false;
  let lspFailureReported = false;
  let reconnectTimer: NodeJS.Timeout | null = null;

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

  // DAP lazy connection helper (with lock to prevent concurrent connection attempts)
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

  // Set up DAP event handlers
  dapClient.on('output', (event: DAPOutputEventBody) => {
    consoleManager.addOutput(event);
  });

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
      const result = await getDiagnostics(diagnosticsManager, isConnected, input);

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
      const result = await scanWorkspaceDiagnostics(diagnosticsManager, isConnected);

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
      // Lazy connect: try to connect to DAP if not already connected
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

  const scheduleLSPReconnect = (): void => {
    if (!lspClient.shouldReconnect() || reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectLSP();
    }, 5000);
  };

  const connectLSP = async (): Promise<void> => {
    if (!lspClient.shouldReconnect()) return;
    try {
      await lspClient.connect();
      if (lspClient.shouldReconnect()) {
        isConnected = true;
        lspFailureReported = false;
      }
    } catch (error) {
      if (!lspFailureReported && lspClient.shouldReconnect()) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Godot LSP unavailable: ${message}. Retrying every 5 seconds.`);
        lspFailureReported = true;
      }
      scheduleLSPReconnect();
    }
  };

  lspClient.on('close', () => {
    console.error('LSP connection closed.');
    isConnected = false;
    scheduleLSPReconnect();
  });

  // Handle DAP events
  dapClient.on('close', () => {
    console.error('DAP connection closed. Will reconnect on next tool call.');
    isDAPConnected = false;
  });

  dapClient.on('terminated', () => {
    console.error('Debug session ended. Run a scene in Godot to capture console output.');
    isDAPConnected = false;
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

    // Stop LSP reconnection loop
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
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

  // MCP stays available while Godot connects, initializes or waits for a retry.
  void connectLSP();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
