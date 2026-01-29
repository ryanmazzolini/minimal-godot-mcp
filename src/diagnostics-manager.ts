import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolve, relative } from 'path';
import fg from 'fast-glob';
import { LSPClient } from './lsp-client.js';
import { Diagnostic } from './types.js';

/**
 * Manages workspace-wide diagnostic operations
 */
export class DiagnosticsManager {
  private workspacePath: string | null = null;

  constructor(private lspClient: LSPClient) {
    // Listen for workspace changes from Godot
    lspClient.on('workspaceChange', (params: unknown) => {
      const oldPath = this.workspacePath;
      if (params && typeof params === 'object' && 'path' in params) {
        this.workspacePath = params.path as string;
        if (oldPath !== this.workspacePath) {
          console.error(`[DiagnosticsManager] Workspace changed: ${oldPath || '(none)'} -> ${this.workspacePath}`);
        }
      } else {
        console.error(`[DiagnosticsManager] Invalid workspace change params:`, params);
      }
    });
  }

  /**
   * Set workspace path (from gdscript_client/changeWorkspace)
   */
  setWorkspace(path: string): void {
    if (!existsSync(path)) {
      console.error(`[DiagnosticsManager] Warning: Workspace path does not exist: ${path}`);
    }
    this.workspacePath = path;
  }

  /**
   * Ensure workspace path is set, throwing if not
   */
  private ensureWorkspace(): string {
    if (!this.workspacePath) {
      throw new Error('Workspace path not set. Ensure Godot is running with a project open.');
    }
    return this.workspacePath;
  }

  /**
   * Get diagnostics for a specific file
   */
  async getFileDiagnostics(filePath: string): Promise<Diagnostic[]> {
    const workspace = this.ensureWorkspace();

    // Validate path is within workspace to prevent path traversal
    const normalizedPath = resolve(filePath);
    const relativePath = relative(workspace, normalizedPath);

    if (relativePath.startsWith('..') || !relativePath) {
      throw new Error(`File path must be within workspace: ${filePath}`);
    }

    let content: string;
    try {
      content = await readFile(normalizedPath, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      throw new Error(`Cannot read file ${filePath}: ${msg}`);
    }

    await this.lspClient.openFile(normalizedPath, content);
    return this.lspClient.getDiagnostics(normalizedPath);
  }

  /**
   * Scan entire workspace for diagnostics
   */
  async scanWorkspace(): Promise<Record<string, Diagnostic[]>> {
    const workspace = this.ensureWorkspace();

    console.error(`[SCAN] Workspace path: ${workspace}`);

    // Find all .gd files
    const files = await fg('**/*.gd', {
      cwd: workspace,
      absolute: true,
      ignore: ['**/addons/**', '**/.godot/**'],
    });

    console.error(`[SCAN] Found ${files.length} .gd files`);
    if (files.length <= 5) {
      console.error(`[SCAN] Files found:`, files);
    }

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
