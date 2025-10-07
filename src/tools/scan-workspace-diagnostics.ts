import { DiagnosticsManager } from '../diagnostics-manager.js';
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
      error: `Godot LSP is not running. Please start Godot with your project:

CLI: godot --editor --path /path/to/project
GUI: Open the project in Godot Editor

The Language Server Protocol must be enabled (default: ON) in:
Project → Project Settings → Network → Language Server

Once Godot is running, diagnostics will be available automatically.`,
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
    '⚠️ EXPENSIVE: Scans ALL .gd files in workspace (may take 5-30s for 100+ files). Use sparingly - only when you need workspace-wide diagnostics. For single file checks, use get_diagnostics instead. Opens each .gd file (excluding addons/ and .godot/) to retrieve diagnostics from Godot LSP.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};
