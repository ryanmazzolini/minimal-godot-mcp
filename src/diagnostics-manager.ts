import { readFile } from 'fs/promises';
import fg from 'fast-glob';
import { LSPClient } from './lsp-client.js';
import { Diagnostic } from './types.js';

/**
 * Manages workspace-wide diagnostic operations
 */
export class DiagnosticsManager {
  private workspacePath: string | null = null;

  constructor(private lspClient: LSPClient) {}

  /**
   * Set workspace path (from gdscript_client/changeWorkspace)
   */
  setWorkspace(path: string): void {
    this.workspacePath = path;
  }

  /**
   * Get diagnostics for a specific file
   */
  async getFileDiagnostics(filePath: string): Promise<Diagnostic[]> {
    const content = await readFile(filePath, 'utf-8');
    await this.lspClient.openFile(filePath, content);
    return this.lspClient.getDiagnostics(filePath);
  }

  /**
   * Scan entire workspace for diagnostics
   */
  async scanWorkspace(): Promise<Record<string, Diagnostic[]>> {
    if (!this.workspacePath) {
      throw new Error('Workspace path not set. Ensure Godot is running with a project open.');
    }

    // Find all .gd files
    const files = await fg('**/*.gd', {
      cwd: this.workspacePath,
      absolute: true,
      ignore: ['**/addons/**', '**/.godot/**'],
    });

    console.error(`[SCAN] Opening ${files.length} files`);

    // Open all files in batches
    const BATCH_SIZE = 50;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((file) =>
          this.getFileDiagnostics(file).catch((err) => {
            console.error(`[SCAN] Failed: ${file}:`, err.message);
          })
        )
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Return all diagnostics (LSPClient already caches them)
    return this.lspClient.getAllDiagnostics();
  }
}
