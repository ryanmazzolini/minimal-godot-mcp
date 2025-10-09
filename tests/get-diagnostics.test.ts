import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { getDiagnostics } from '../src/tools/get-diagnostics.js';
import { DiagnosticsManager } from '../src/diagnostics-manager.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_FILE = join(__dirname, 'fixtures', 'test-script.gd');

describe('get_diagnostics tool', () => {
  let mockDiagnosticsManager: DiagnosticsManager;

  beforeEach(() => {
    mockDiagnosticsManager = {
      getFileDiagnostics: mock.fn((path: string) => {
        if (path === TEST_FILE) {
          return Promise.resolve([
            { line: 5, column: 10, severity: 'error' as const, message: 'Syntax error' },
          ]);
        }
        return Promise.resolve([]);
      }),
    } as unknown as DiagnosticsManager;
  });

  it('should return diagnostics for specific file', async () => {
    const result = await getDiagnostics(mockDiagnosticsManager, true, {
      file_path: TEST_FILE,
    });

    assert.deepStrictEqual(result.diagnostics, {
      [TEST_FILE]: [
        { line: 5, column: 10, severity: 'error', message: 'Syntax error' },
      ],
    });
    assert.strictEqual(result.error, undefined);
  });

  it('should return error when LSP not connected', async () => {
    const result = await getDiagnostics(mockDiagnosticsManager, false, {
      file_path: TEST_FILE,
    });

    assert.deepStrictEqual(result.diagnostics, {});
    assert.match(result.error ?? '', /Godot LSP is not running/);
  });

  it('should reject non-.gd files', async () => {
    await assert.rejects(
      getDiagnostics(mockDiagnosticsManager, true, { file_path: '/project/script.txt' }),
      /file_path must be a \.gd file/
    );
  });

  it('should require file_path parameter', async () => {
    await assert.rejects(
      getDiagnostics(mockDiagnosticsManager, true, {}),
      /file_path is required/
    );
  });

  it('should accept .gd files', async () => {
    const result = await getDiagnostics(mockDiagnosticsManager, true, {
      file_path: TEST_FILE,
    });

    assert.strictEqual(result.error, undefined);
  });
});
