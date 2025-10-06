import {
  Diagnostic,
  DiagnosticSeverity,
  LSPDiagnostic,
  LSPDiagnosticSeverity,
} from './types.js';

/**
 * In-memory diagnostic cache
 */
export class DiagnosticCache {
  private cache = new Map<string, Diagnostic[]>();

  /**
   * Store diagnostics for a file path
   */
  set(filePath: string, diagnostics: Diagnostic[]): void {
    this.cache.set(filePath, diagnostics);
  }

  /**
   * Get diagnostics for a file path
   */
  get(filePath: string): Diagnostic[] {
    return this.cache.get(filePath) ?? [];
  }

  /**
   * Clear diagnostics for a file path
   */
  clear(filePath: string): void {
    this.cache.delete(filePath);
  }

  /**
   * Clear all diagnostics
   */
  clearAll(): void {
    this.cache.clear();
  }

  /**
   * Get all diagnostics as a map
   */
  getAll(): Record<string, Diagnostic[]> {
    const result: Record<string, Diagnostic[]> = {};
    for (const [path, diagnostics] of this.cache.entries()) {
      result[path] = diagnostics;
    }
    return result;
  }
}

/**
 * Convert LSP severity to MCP severity
 */
function convertSeverity(lspSeverity?: LSPDiagnosticSeverity): DiagnosticSeverity {
  switch (lspSeverity) {
    case LSPDiagnosticSeverity.Error:
      return 'error';
    case LSPDiagnosticSeverity.Warning:
      return 'warning';
    case LSPDiagnosticSeverity.Information:
    case LSPDiagnosticSeverity.Hint:
      return 'info';
    default:
      return 'error'; // Default to error if severity unknown
  }
}

/**
 * Transform LSP diagnostic to MCP diagnostic format
 */
export function transformDiagnostic(lspDiag: LSPDiagnostic): Diagnostic {
  return {
    line: lspDiag.range.start.line + 1, // LSP is 0-indexed, convert to 1-indexed
    column: lspDiag.range.start.character + 1,
    severity: convertSeverity(lspDiag.severity),
    message: lspDiag.message,
    code: lspDiag.code?.toString(),
  };
}

/**
 * Transform array of LSP diagnostics
 */
export function transformDiagnostics(lspDiags: LSPDiagnostic[]): Diagnostic[] {
  return lspDiags.map(transformDiagnostic);
}
