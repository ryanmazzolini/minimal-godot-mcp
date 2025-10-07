import { DiagnosticsManager } from '../diagnostics-manager.js';
import { Diagnostic } from '../types.js';

export interface GetDiagnosticsInput {
  file_path?: string;
}

export interface GetDiagnosticsOutput {
  diagnostics: Record<string, Diagnostic[]>;
  error?: string;
}

/**
 * Get diagnostics for a specific GDScript file
 */
export async function getDiagnostics(
  diagnosticsManager: DiagnosticsManager,
  isConnected: boolean,
  input: GetDiagnosticsInput
): Promise<GetDiagnosticsOutput> {
  const { file_path } = input;

  // Validate input
  if (!file_path) {
    throw new Error('file_path is required. Use scan_workspace_diagnostics for workspace-wide checks.');
  }

  if (!file_path.endsWith('.gd')) {
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

  // Get diagnostics for specific file
  const fileDiagnostics = await diagnosticsManager.getFileDiagnostics(file_path);
  return { diagnostics: { [file_path]: fileDiagnostics } };
}

/**
 * Tool schema for MCP
 */
export const getDiagnosticsTool = {
  name: 'get_diagnostics',
  description:
    'Get syntax diagnostics from Godot LSP for a specific GDScript file. Fast operation (<1s). Use this for single file checks. For workspace-wide scanning, use scan_workspace_diagnostics instead.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the .gd file to check for syntax errors.',
      },
    },
    required: ['file_path'],
  },
};
