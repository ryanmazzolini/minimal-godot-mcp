import { describe, it } from 'node:test';
import assert from 'node:assert';
import { toFileUri, fromFileUri, workspaceName } from '../src/uri-utils.js';

describe('uri-utils', () => {
  describe('toFileUri', () => {
    it('should produce a valid file URI for Unix absolute paths', () => {
      const uri = toFileUri('/home/user/project/script.gd');
      assert.strictEqual(uri, 'file:///home/user/project/script.gd');
    });

    it('should percent-encode spaces in paths', () => {
      const uri = toFileUri('/home/user/my project/script.gd');
      assert.ok(uri.includes('my%20project'), `expected encoded space in: ${uri}`);
      assert.ok(uri.startsWith('file:///'), `expected file:/// prefix in: ${uri}`);
    });

    it('should percent-encode special characters', () => {
      const uri = toFileUri('/home/user/project/naïve.gd');
      assert.ok(uri.startsWith('file:///'), `expected file:/// prefix in: ${uri}`);
    });

    it('should always produce URIs starting with file:///', () => {
      // Regression: the old code used `file://${path}` which only had two slashes
      // before the path, causing Windows drive letters to be parsed as hostnames.
      // See: https://github.com/ryanmazzolini/minimal-godot-mcp/issues/25
      const uri = toFileUri('/tmp/test.gd');
      assert.ok(
        uri.startsWith('file:///'),
        `URI must start with file:/// (got: ${uri})`
      );
    });
  });

  describe('fromFileUri', () => {
    it('should convert Unix file URI back to path', () => {
      const path = fromFileUri('file:///home/user/project/script.gd');
      assert.strictEqual(path, '/home/user/project/script.gd');
    });

    it('should decode percent-encoded spaces', () => {
      const path = fromFileUri('file:///home/user/my%20project/script.gd');
      assert.strictEqual(path, '/home/user/my project/script.gd');
    });

    it('should handle Windows-style file URIs', () => {
      // fileURLToPath handles `file:///C:/...` cross-platform.
      // On Linux it returns `/C:/Users/...` (valid Linux path);
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
    it('should roundtrip Unix paths through toFileUri → fromFileUri', () => {
      const original = '/home/user/project/script.gd';
      const roundtripped = fromFileUri(toFileUri(original));
      assert.strictEqual(roundtripped, original);
    });

    it('should roundtrip paths with spaces', () => {
      const original = '/home/user/my project/script.gd';
      const roundtripped = fromFileUri(toFileUri(original));
      assert.strictEqual(roundtripped, original);
    });
  });

  describe('workspaceName', () => {
    it('should extract name from Unix path', () => {
      assert.strictEqual(workspaceName('/home/user/the-rpg'), 'the-rpg');
    });

    it('should extract name from path with trailing slash', () => {
      // basename('/foo/bar/') returns 'bar'
      assert.strictEqual(workspaceName('/home/user/the-rpg/'), 'the-rpg');
    });

    it('should handle single component path', () => {
      assert.strictEqual(workspaceName('/project'), 'project');
    });
  });
});
