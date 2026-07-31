/**
 * Utilities for handling cross-platform paths, especially WSL/Windows conversions
 */

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
 * Normalize path to the current platform's format
 * Detects WSL automatically and converts Windows paths if needed
 */
export function normalizePath(path: string): string {
  // If we're on WSL (process.platform === 'linux' but /mnt/c exists),
  // convert Windows paths to WSL paths
  if (process.platform === 'linux') {
    return normalizeToWSLPath(path);
  }

  // On Windows, convert WSL paths to Windows paths
  if (process.platform === 'win32') {
    return normalizeToWindowsPath(path);
  }

  // On other platforms (Mac, etc.), return as-is
  return path;
}
