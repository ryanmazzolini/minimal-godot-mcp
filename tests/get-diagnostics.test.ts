import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { getDiagnostics } from '../src/tools/get-diagnostics.js';
import { LSPClient } from '../src/lsp-client.js';

describe('get_diagnostics tool', () => {
  let mockLspClient: LSPClient;

  beforeEach(() => {
    mockLspClient = {
      getDiagnostics: mock.fn((path: string) => {
        if (path === '/project/script.gd') {
          return [{ line: 5, column: 10, severity: 'error', message: 'Syntax error' }];
        }
        return [];
      }),
      getAllDiagnostics: mock.fn(() => ({
        '/project/script.gd': [
          { line: 5, column: 10, severity: 'error', message: 'Syntax error' },
        ],
        '/project/player.gd': [
          { line: 20, column: 5, severity: 'warning', message: 'Unused variable' },
        ],
      })),
    } as unknown as LSPClient;
  });

  it('should return diagnostics for specific file', async () => {
    const result = await getDiagnostics(mockLspClient, true, {
      file_path: '/project/script.gd',
    });

    assert.deepStrictEqual(result.diagnostics, {
      '/project/script.gd': [
        { line: 5, column: 10, severity: 'error', message: 'Syntax error' },
      ],
    });
    assert.strictEqual(result.error, undefined);
  });

  it('should return all diagnostics when file_path omitted', async () => {
    const result = await getDiagnostics(mockLspClient, true, {});

    assert.deepStrictEqual(result.diagnostics, {
      '/project/script.gd': [
        { line: 5, column: 10, severity: 'error', message: 'Syntax error' },
      ],
      '/project/player.gd': [
        { line: 20, column: 5, severity: 'warning', message: 'Unused variable' },
      ],
    });
  });

  it('should return error when LSP not connected', async () => {
    const result = await getDiagnostics(mockLspClient, false, {
      file_path: '/project/script.gd',
    });

    assert.deepStrictEqual(result.diagnostics, {});
    assert.match(result.error ?? '', /Godot LSP is not running/);
  });

  it('should reject non-.gd files', async () => {
    await assert.rejects(
      getDiagnostics(mockLspClient, true, { file_path: '/project/script.txt' }),
      /file_path must be a \.gd file/
    );
  });

  it('should accept .gd files', async () => {
    const result = await getDiagnostics(mockLspClient, true, {
      file_path: '/project/script.gd',
    });

    assert.strictEqual(result.error, undefined);
  });
});
