import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  DiagnosticCache,
  transformDiagnostic,
  transformDiagnostics,
} from '../src/diagnostics.js';
import { LSPDiagnostic, LSPDiagnosticSeverity } from '../src/types.js';

describe('DiagnosticCache', () => {
  it('should store and retrieve diagnostics for a file', () => {
    const cache = new DiagnosticCache();
    const diagnostics = [
      { line: 1, column: 5, severity: 'error' as const, message: 'Test error' },
    ];

    cache.set('/path/to/file.gd', diagnostics);
    assert.deepStrictEqual(cache.get('/path/to/file.gd'), diagnostics);
  });

  it('should return empty array for non-existent file', () => {
    const cache = new DiagnosticCache();
    assert.deepStrictEqual(cache.get('/nonexistent.gd'), []);
  });

  it('should clear specific file diagnostics', () => {
    const cache = new DiagnosticCache();
    cache.set('/file1.gd', [{ line: 1, column: 1, severity: 'error', message: 'Error' }]);
    cache.set('/file2.gd', [{ line: 2, column: 2, severity: 'warning', message: 'Warning' }]);

    cache.clear('/file1.gd');
    assert.deepStrictEqual(cache.get('/file1.gd'), []);
    assert.strictEqual(cache.get('/file2.gd').length, 1);
  });

  it('should clear all diagnostics', () => {
    const cache = new DiagnosticCache();
    cache.set('/file1.gd', [{ line: 1, column: 1, severity: 'error', message: 'Error' }]);
    cache.set('/file2.gd', [{ line: 2, column: 2, severity: 'warning', message: 'Warning' }]);

    cache.clearAll();
    assert.deepStrictEqual(cache.get('/file1.gd'), []);
    assert.deepStrictEqual(cache.get('/file2.gd'), []);
  });

  it('should get all diagnostics as map', () => {
    const cache = new DiagnosticCache();
    const diag1 = [{ line: 1, column: 1, severity: 'error' as const, message: 'Error' }];
    const diag2 = [{ line: 2, column: 2, severity: 'warning' as const, message: 'Warning' }];

    cache.set('/file1.gd', diag1);
    cache.set('/file2.gd', diag2);

    const all = cache.getAll();
    assert.deepStrictEqual(all, {
      '/file1.gd': diag1,
      '/file2.gd': diag2,
    });
  });
});

describe('transformDiagnostic', () => {
  it('should convert LSP diagnostic to MCP format', () => {
    const lspDiag: LSPDiagnostic = {
      range: {
        start: { line: 10, character: 5 },
        end: { line: 10, character: 10 },
      },
      severity: LSPDiagnosticSeverity.Error,
      message: 'Syntax error',
      code: 'E001',
    };

    const result = transformDiagnostic(lspDiag);

    assert.deepStrictEqual(result, {
      line: 11, // LSP is 0-indexed, we convert to 1-indexed
      column: 6,
      severity: 'error',
      message: 'Syntax error',
      code: 'E001',
    });
  });

  it('should handle different severity levels', () => {
    const warning: LSPDiagnostic = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      severity: LSPDiagnosticSeverity.Warning,
      message: 'Warning',
    };

    assert.strictEqual(transformDiagnostic(warning).severity, 'warning');

    const info: LSPDiagnostic = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      severity: LSPDiagnosticSeverity.Information,
      message: 'Info',
    };

    assert.strictEqual(transformDiagnostic(info).severity, 'info');
  });

  it('should default to error for unknown severity', () => {
    const diagnostic: LSPDiagnostic = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: 'Unknown severity',
    };

    assert.strictEqual(transformDiagnostic(diagnostic).severity, 'error');
  });
});

describe('transformDiagnostics', () => {
  it('should transform array of LSP diagnostics', () => {
    const lspDiags: LSPDiagnostic[] = [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: LSPDiagnosticSeverity.Error,
        message: 'Error 1',
      },
      {
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
        severity: LSPDiagnosticSeverity.Warning,
        message: 'Warning 1',
      },
    ];

    const result = transformDiagnostics(lspDiags);

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].severity, 'error');
    assert.strictEqual(result[1].severity, 'warning');
  });
});
