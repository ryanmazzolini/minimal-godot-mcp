import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, writeFile, rm, realpath } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { isGodotProject, getWorkspaceFromCwd } from '../src/workspace-detection.js';

describe('workspace-detection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'godot-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('isGodotProject', () => {
    it('should return true when project.godot exists', async () => {
      await writeFile(join(tempDir, 'project.godot'), '');
      assert.strictEqual(await isGodotProject(tempDir), true);
    });

    it('should return false when project.godot does not exist', async () => {
      assert.strictEqual(await isGodotProject(tempDir), false);
    });

    it('should return false for non-existent directory', async () => {
      assert.strictEqual(await isGodotProject('/non/existent/path'), false);
    });
  });

  describe('getWorkspaceFromCwd', () => {
    const originalCwd = process.cwd();

    afterEach(() => {
      process.chdir(originalCwd);
    });

    it('should return cwd when it is a Godot project', async () => {
      await writeFile(join(tempDir, 'project.godot'), '');
      process.chdir(tempDir);
      const result = await getWorkspaceFromCwd();
      // Normalize paths to handle macOS /var -> /private/var symlink
      const normalizedResult = result ? await realpath(result) : null;
      const normalizedExpected = await realpath(tempDir);
      assert.strictEqual(normalizedResult, normalizedExpected);
    });

    it('should return null when cwd is not a Godot project', async () => {
      process.chdir(tempDir);
      assert.strictEqual(await getWorkspaceFromCwd(), null);
    });
  });
});
