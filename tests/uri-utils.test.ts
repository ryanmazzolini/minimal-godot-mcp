import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolve, sep } from 'node:path';
import { toFileUri, fromFileUri, workspaceName } from '../src/uri-utils.js';

const isWindows = process.platform === 'win32';

describe('uri-utils', () => {
  describe('toFileUri', () => {
    it('should produce a valid file URI from a platform-native path', () => {
      const absPath = resolve('/home/user/project/script.gd');
      const uri = toFileUri(absPath);
      assert.ok(uri.startsWith('file:///'), `URI must use file:/// scheme: ${uri}`);
      assert.ok(!uri.includes('\\'), `URI must not contain backslashes: ${uri}`);
      assert.ok(uri.endsWith('script.gd'));
    });

    it('should percent-encode spaces in paths', () => {
      const absPath = resolve('/home/user/my project/script.gd');
      const uri = toFileUri(absPath);
      assert.ok(uri.includes('my%20project'), `expected encoded space in: ${uri}`);
      assert.ok(uri.startsWith('file:///'), `expected file:/// prefix in: ${uri}`);
    });

    it('should percent-encode special characters', () => {
      const absPath = resolve('/home/user/project/naïve.gd');
      const uri = toFileUri(absPath);
      assert.ok(uri.startsWith('file:///'), `expected file:/// prefix in: ${uri}`);
    });

    it('should always produce URIs starting with file:///', () => {
      // Regression: the old code used `file://${path}` which only had two slashes
      // before the path, causing Windows drive letters to be parsed as hostnames.
      // See: https://github.com/ryanmazzolini/minimal-godot-mcp/issues/25
      const absPath = resolve('/tmp/test.gd');
      const uri = toFileUri(absPath);
      assert.ok(uri.startsWith('file:///'), `URI must start with file:/// (got: ${uri})`);
    });
  });

  describe('fromFileUri', () => {
    it('should roundtrip a platform-native path through toFileUri', () => {
      const absPath = resolve('/home/user/project/script.gd');
      const path = fromFileUri(toFileUri(absPath));
      assert.strictEqual(path, absPath);
    });

    it('should decode percent-encoded spaces', () => {
      const absPath = resolve('/home/user/my project/script.gd');
      const path = fromFileUri(toFileUri(absPath));
      assert.ok(path.includes('my project'), `expected decoded space in: ${path}`);
    });

    it('should handle Windows-style file URIs with drive letters', () => {
      // file:///C:/... is valid on all platforms.
      // On Linux fileURLToPath returns `/C:/Users/...`;
      // on Windows it returns `C:\Users\...`.
      const path = fromFileUri('file:///C:/Users/josh/project/script.gd');
      assert.ok(path.includes('C:'), `expected drive letter in: ${path}`);
      assert.ok(path.endsWith('script.gd'), `expected filename in: ${path}`);
    });

    it('should throw on invalid URI scheme', () => {
      assert.throws(
        () => fromFileUri('http://example.com/file.gd'),
        /file/i
      );
    });

    it('should throw on malformed URI', () => {
      assert.throws(
        () => fromFileUri('not-a-uri'),
        { code: 'ERR_INVALID_URL' }
      );
    });
  });

  describe('roundtrip', () => {
    it('should roundtrip platform-native absolute paths', () => {
      const original = resolve('/home/user/project/script.gd');
      const roundtripped = fromFileUri(toFileUri(original));
      assert.strictEqual(roundtripped, original);
    });

    it('should roundtrip paths with spaces', () => {
      const original = resolve('/home/user/my project/script.gd');
      const roundtripped = fromFileUri(toFileUri(original));
      assert.strictEqual(roundtripped, original);
    });
  });

  describe('workspaceName', () => {
    it('should extract name from path', () => {
      const path = isWindows ? 'C:\\Users\\user\\the-rpg' : '/home/user/the-rpg';
      assert.strictEqual(workspaceName(path), 'the-rpg');
    });

    it('should extract name from path with trailing separator', () => {
      const path = isWindows ? 'C:\\Users\\user\\the-rpg\\' : '/home/user/the-rpg/';
      assert.strictEqual(workspaceName(path), 'the-rpg');
    });

    it('should handle single component path', () => {
      const path = `${sep}project`;
      assert.strictEqual(workspaceName(path), 'project');
    });
  });
});
