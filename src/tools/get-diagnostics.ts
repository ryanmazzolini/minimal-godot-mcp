import { LSPClient } from '../lsp-client.js';
import { Diagnostic } from '../types.js';

export interface GetDiagnosticsInput {
  file_path?: string;
}

export interface GetDiagnosticsOutput {
  diagnostics: Record<string, Diagnostic[]>;
  error?: string;
}

/**
 * Get diagnostics for a GDScript file (or all files if path not provided)
 */
export async function getDiagnostics(
  lspClient: LSPClient,
  isConnected: boolean,
  input: GetDiagnosticsInput
): Promise<GetDiagnosticsOutput> {
  const { file_path } = input;

  // Validate input if file_path provided
  if (file_path && !file_path.endsWith('.gd')) {
    throw new Error('file_path must be a .gd file');
  }

  // Check if LSP is connected
  if (!isConnected) {
    return {
      diagnostics: {},
      error: `Godot LSP is not running. Please ask the user to start Godot with their project:

CLI: godot --editor --path /path/to/project
GUI: Open the project in Godot Editor

The Language Server Protocol must be enabled (default: ON) in:
Project → Project Settings → Network → Language Server

Once Godot is running, diagnostics will be available automatically.`,
    };
  }

  // Get diagnostics - specific file or all files
  if (file_path) {
    // Read file content and request diagnostics from LSP
    try {
      const fs = await import('fs/promises');
      const fileContent = await fs.readFile(file_path, 'utf-8');
      await lspClient.openFile(file_path, fileContent);
    } catch (error) {
      throw new Error(`Failed to read file: ${(error as Error).message}`);
    }

    const fileDiagnostics = lspClient.getDiagnostics(file_path);
    return { diagnostics: { [file_path]: fileDiagnostics } };
  }

  return { diagnostics: lspClient.getAllDiagnostics() };
}

/**
 * Tool schema for MCP
 */
export const getDiagnosticsTool = {
  name: 'get_diagnostics',
  description:
    'Get syntax diagnostics from Godot LSP for GDScript files. IMPORTANT: You must provide file_path to check a specific file. Without file_path, only returns cached diagnostics from previously checked files (useful for batch operations).',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the .gd file to check for syntax errors. Required for first-time checks.',
      },
    },
    required: [],
  },
};
