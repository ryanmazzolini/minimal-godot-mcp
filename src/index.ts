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

/**
 * Main MCP server
 */
async function main(): Promise<void> {
  // Initialize LSP client (don't connect yet)
  const lspClient = new LSPClient();
  const diagnosticsManager = new DiagnosticsManager(lspClient);
  let isConnected = false;
  let isReconnecting = false;
  let reconnectTimer: NodeJS.Timeout | null = null;

  // Set workspace path if provided
  const workspacePath = process.env.GODOT_WORKSPACE_PATH;
  if (workspacePath) {
    diagnosticsManager.setWorkspace(workspacePath);
  }

  // Try to connect to Godot LSP (non-blocking)
  try {
    await lspClient.connect();
    isConnected = true;
  } catch (error) {
    const err = error as Error;
    console.error(`Warning: ${err.message}`);
    console.error('MCP server will start anyway. Diagnostics will be unavailable until Godot is running.');
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
    tools: [getDiagnosticsTool, scanWorkspaceDiagnosticsTool],
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

    throw new Error(`Unknown tool: ${name}`);
  });

  // Handle errors
  server.onerror = (error) => {
    console.error('MCP Server error:', error);
  };

  lspClient.on('close', () => {
    console.error('LSP connection closed.');
    isConnected = false;

    // Skip if shutting down or already reconnecting
    if (!lspClient.shouldReconnect() || isReconnecting) {
      if (isReconnecting) {
        console.error('Reconnection already in progress');
      }
      return;
    }

    isReconnecting = true;
    console.error('Starting reconnection loop...');

    // Attempt to reconnect
    const reconnect = async (): Promise<void> => {
      if (!lspClient.shouldReconnect()) {
        isReconnecting = false;
        return;
      }

      try {
        await lspClient.connect();
        console.error('Reconnected to Godot LSP');
        isConnected = true;
        isReconnecting = false;
      } catch {
        // Retry after 5 seconds
        reconnectTimer = setTimeout(reconnect, 5000);
      }
    };

    reconnectTimer = setTimeout(reconnect, 5000);
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Godot MCP server running');

  // Cleanup on exit
  let cleanupCalled = false;
  const cleanup = (signal: string) => {
    if (cleanupCalled) return;
    cleanupCalled = true;

    console.error(`Shutting down (${signal})...`);

    // Stop reconnection loop
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    isReconnecting = false;

    // Disconnect LSP client
    lspClient.disconnect();

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
