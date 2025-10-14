import { access, constants } from 'fs/promises';
import { join } from 'path';

/**
 * Check if a directory is a Godot project root (contains project.godot)
 */
export async function isGodotProject(dirPath: string): Promise<boolean> {
  try {
    const projectFile = join(dirPath, 'project.godot');
    await access(projectFile, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current working directory workspace path if it's a Godot project
 */
export async function getWorkspaceFromCwd(): Promise<string | null> {
  const cwd = process.cwd();
  if (await isGodotProject(cwd)) {
    return cwd;
  }
  return null;
}
