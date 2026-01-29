import { DiagnosticsManager } from '../diagnostics-manager.js';
import { LSP_NOT_RUNNING_ERROR } from '../errors.js';
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
      error: LSP_NOT_RUNNING_ERROR,
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
    'Check GDScript files for errors after editing or when analyzing code. ' +
    'Returns syntax errors, type errors, undefined variables, missing functions, and code quality issues from Godot LSP (<1s). ' +
    'Use this tool when: user references .gd files, requests GDScript modifications, or reports code errors. ' +
    'For workspace-wide validation, use scan_workspace_diagnostics instead.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the GDScript (.gd) file to analyze for errors, warnings, and issues.',
      },
    },
    required: ['file_path'],
  },
};
