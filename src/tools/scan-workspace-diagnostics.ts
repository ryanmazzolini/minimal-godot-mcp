import { DiagnosticsManager } from '../diagnostics-manager.js';
import { LSP_NOT_RUNNING_ERROR } from '../errors.js';
import { Diagnostic } from '../types.js';

export interface ScanWorkspaceOutput {
  files_scanned: number;
  files_with_issues: number;
  scan_time_seconds: number;
  diagnostics: Record<string, Diagnostic[]>;
  error?: string;
}

/**
 * Scan entire workspace for diagnostics
 */
export async function scanWorkspaceDiagnostics(
  diagnosticsManager: DiagnosticsManager,
  isConnected: boolean
): Promise<ScanWorkspaceOutput> {
  // Check if LSP is connected
  if (!isConnected) {
    return {
      files_scanned: 0,
      files_with_issues: 0,
      scan_time_seconds: 0,
      diagnostics: {},
      error: LSP_NOT_RUNNING_ERROR,
    };
  }

  const startTime = Date.now();
  const diagnostics = await diagnosticsManager.scanWorkspace();
  const scanTime = ((Date.now() - startTime) / 1000).toFixed(2);

  const filesScanned = Object.keys(diagnostics).length;
  const filesWithIssues = Object.values(diagnostics).filter((d) => d.length > 0).length;

  return {
    files_scanned: filesScanned,
    files_with_issues: filesWithIssues,
    scan_time_seconds: parseFloat(scanTime),
    diagnostics,
  };
}

/**
 * Tool schema for MCP
 */
export const scanWorkspaceDiagnosticsTool = {
  name: 'scan_workspace_diagnostics',
  description:
    'EXPENSIVE OPERATION: Scans ALL GDScript (.gd) files in workspace for errors, warnings, and issues (may take 5-30s for 100+ files). Use sparingly - only when you need to find problems across the entire codebase. For checking individual files, use get_diagnostics instead. Opens each .gd file (excluding addons/ and .godot/) to retrieve diagnostics from Godot Language Server.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};
