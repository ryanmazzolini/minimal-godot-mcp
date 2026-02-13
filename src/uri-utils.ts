import { pathToFileURL, fileURLToPath } from 'url';
import { basename } from 'path';

/**
 * Convert a filesystem path to a file:// URI using Node's standard library.
 *
 * On Windows this produces `file:///C:/Users/...` (three slashes, forward slashes)
 * instead of the broken `file://C:\Users\...` which gets `C:` parsed as a hostname.
 * See: https://github.com/ryanmazzolini/minimal-godot-mcp/issues/25
 */
export function toFileUri(filePath: string): string {
  return pathToFileURL(filePath).href;
}

/**
 * Convert a file:// URI back to a filesystem path.
 * Wraps fileURLToPath with a clearer error for debugging.
 */
export function fromFileUri(uri: string): string {
  return fileURLToPath(uri);
}

/**
 * Extract the workspace name from a workspace path (cross-platform).
 * Uses path.basename instead of split('/') which breaks on Windows backslashes.
 */
export function workspaceName(workspacePath: string): string {
  return basename(workspacePath);
}
