import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DiagnosticsManager } from '../src/diagnostics-manager.js';
import { LSPClient } from '../src/lsp-client.js';

describe('DiagnosticsManager', () => {
  let lspClient: LSPClient;
  let diagnosticsManager: DiagnosticsManager;

  beforeEach(() => {
    lspClient = new LSPClient();
    diagnosticsManager = new DiagnosticsManager(lspClient);
    diagnosticsManager.setWorkspace('/fake/workspace');
  });

  describe('getFileDiagnostics', () => {
    it('should reject paths outside workspace', async () => {
      await assert.rejects(
        diagnosticsManager.getFileDiagnostics('../../../etc/passwd'),
        /File path must be within workspace/
      );
    });

    it('should reject absolute paths outside workspace', async () => {
      await assert.rejects(
        diagnosticsManager.getFileDiagnostics('/etc/passwd'),
        /File path must be within workspace/
      );
    });

    it('should reject paths with .. traversal', async () => {
      await assert.rejects(
        diagnosticsManager.getFileDiagnostics('/fake/workspace/../outside/file.gd'),
        /File path must be within workspace/
      );
    });

    it('should reject when workspace not set', async () => {
      const manager = new DiagnosticsManager(lspClient);
      await assert.rejects(
        manager.getFileDiagnostics('/any/path.gd'),
        /Workspace path not set/
      );
    });
  });
});
