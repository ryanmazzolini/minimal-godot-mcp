/**
 * Utilities for handling cross-platform paths, especially WSL/Windows conversions
 */

import { readFileSync } from 'fs';

/**
 * Normalize a Windows path to WSL format if running on WSL
 * E.g., "E:/Work/project" -> "/mnt/e/Work/project"
 */
export function normalizeToWSLPath(path: string): string {
  // Check if this looks like a Windows path (e.g., E:/ or E:\)
  const windowsPathMatch = path.match(/^([A-Za-z]):[/\\]/);

  if (windowsPathMatch) {
    const driveLetter = windowsPathMatch[1].toLowerCase();
    // Convert E:/path/to/file to /mnt/e/path/to/file
    const pathWithoutDrive = path.slice(3); // Remove "E:/"
    const unixPath = pathWithoutDrive.replace(/\\/g, '/');
    return `/mnt/${driveLetter}/${unixPath}`.replace(/\/+/g, '/'); // Clean up double slashes
  }

  return path;
}

/**
 * Normalize a WSL path to Windows format if needed
 * E.g., "/mnt/e/Work/project" -> "E:/Work/project"
 */
export function normalizeToWindowsPath(path: string): string {
  // Check if this is a WSL mount path
  const wslPathMatch = path.match(/^\/mnt\/([a-z])\/(.*)$/);

  if (wslPathMatch) {
    const driveLetter = wslPathMatch[1].toUpperCase();
    const pathAfterDrive = wslPathMatch[2];
    return `${driveLetter}:/${pathAfterDrive}`;
  }

  return path;
}

/**
 * Decide whether we are running under WSL, given the ambient signals.
 *
 * Pure function so the decision can be tested without a WSL machine;
 * `isWSL()` supplies the real inputs.
 *
 * Both signals are needed: WSL_DISTRO_NAME is absent when the process is
 * spawned by a Windows parent (which is exactly the Godot-on-Windows case),
 * and /proc/version is unreadable under some sandboxes.
 */
export function detectWSL(
  platform: string,
  procVersion: string | null,
  wslDistroName?: string
): boolean {
  if (platform !== 'linux') {
    return false;
  }
  if (wslDistroName !== undefined && wslDistroName !== '') {
    return true;
  }
  // WSL1 reports "Microsoft", WSL2 reports "microsoft-standard-WSL2".
  return procVersion !== null && procVersion.toLowerCase().includes('microsoft');
}

function readProcVersion(): string | null {
  try {
    return readFileSync('/proc/version', 'utf8');
  } catch {
    return null;
  }
}

let wslCache: boolean | null = null;

/**
 * Whether this process is running under WSL. Memoized - the answer cannot
 * change during a process lifetime.
 */
export function isWSL(): boolean {
  if (wslCache === null) {
    wslCache = detectWSL(process.platform, readProcVersion(), process.env.WSL_DISTRO_NAME);
  }
  return wslCache;
}

/**
 * Normalize path to the current platform's format
 * Detects WSL automatically and converts Windows paths if needed
 */
export function normalizePath(path: string): string {
  // Only rewrite drive-letter paths when actually on WSL. Plain Linux has no
  // /mnt/<drive> mapping, so rewriting there would invent a bogus path.
  if (isWSL()) {
    return normalizeToWSLPath(path);
  }

  // On Windows, convert WSL paths to Windows paths
  if (process.platform === 'win32') {
    return normalizeToWindowsPath(path);
  }

  // On plain Linux, macOS, etc., return as-is
  return path;
}
