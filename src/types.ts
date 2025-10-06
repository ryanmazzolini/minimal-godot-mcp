/**
 * Diagnostic severity levels
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * LSP Diagnostic severity enum (from LSP spec)
 */
export enum LSPDiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

/**
 * MCP-compatible diagnostic format
 */
export interface Diagnostic {
  line: number;
  column: number;
  severity: DiagnosticSeverity;
  message: string;
  code?: string;
}

/**
 * LSP Position (0-indexed)
 */
export interface LSPPosition {
  line: number;
  character: number;
}

/**
 * LSP Range
 */
export interface LSPRange {
  start: LSPPosition;
  end: LSPPosition;
}

/**
 * LSP Diagnostic from publishDiagnostics notification
 */
export interface LSPDiagnostic {
  range: LSPRange;
  severity?: LSPDiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
}

/**
 * LSP PublishDiagnostics params
 */
export interface LSPPublishDiagnosticsParams {
  uri: string;
  diagnostics: LSPDiagnostic[];
}
