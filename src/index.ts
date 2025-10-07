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
      name: 'godot-server-mcp',
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
    console.error('LSP connection closed. Attempting to reconnect...');
    isConnected = false;

    // Attempt to reconnect
    const reconnect = async (): Promise<void> => {
      try {
        await lspClient.connect();
        console.error('Reconnected to Godot LSP');
        isConnected = true;
      } catch {
        // Retry after 5 seconds
        setTimeout(reconnect, 5000);
      }
    };

    setTimeout(reconnect, 5000);
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Godot MCP server running');

  // Cleanup on exit
  process.on('SIGINT', () => {
    lspClient.disconnect();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
