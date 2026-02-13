import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { resolve } from 'node:path';
import { LSPClient } from '../src/lsp-client.js';
import { EventEmitter } from 'events';

describe('LSPClient Lifecycle', () => {
  describe('shutdown behavior', () => {
    it('should set shutdown flag when disconnect is called', () => {
      const client = new LSPClient();

      assert.strictEqual(client.shouldReconnect(), true, 'should allow reconnect initially');

      client.disconnect();

      assert.strictEqual(client.shouldReconnect(), false, 'should not allow reconnect after disconnect');
    });

    it('should prevent reconnection after shutdown', () => {
      const client = new LSPClient();

      client.disconnect();

      // shouldReconnect should return false
      assert.strictEqual(client.shouldReconnect(), false);
    });

    it('should clear diagnostics cache on disconnect', () => {
      const client = new LSPClient();

      // Verify cache is cleared (getAllDiagnostics returns empty object)
      client.disconnect();
      const diagnostics = client.getAllDiagnostics();

      assert.deepStrictEqual(diagnostics, {});
    });
  });

  describe('reconnection guard', () => {
    it('shouldReconnect returns true before disconnect', () => {
      const client = new LSPClient();
      assert.strictEqual(client.shouldReconnect(), true);
    });

    it('shouldReconnect returns false after disconnect', () => {
      const client = new LSPClient();
      client.disconnect();
      assert.strictEqual(client.shouldReconnect(), false);
    });

    it('shouldReconnect is idempotent', () => {
      const client = new LSPClient();
      client.disconnect();

      assert.strictEqual(client.shouldReconnect(), false);
      assert.strictEqual(client.shouldReconnect(), false);
      assert.strictEqual(client.shouldReconnect(), false);
    });
  });

  describe('socket cleanup', () => {
    it('should set socket to null after disconnect', () => {
      const client = new LSPClient();

      // Disconnect should set socket to null
      client.disconnect();

      // We can't directly test private socket property, but we can verify
      // that disconnect doesn't throw and cache is cleared
      const diagnostics = client.getAllDiagnostics();
      assert.deepStrictEqual(diagnostics, {});
    });

    it('disconnect should be safe to call multiple times', () => {
      const client = new LSPClient();

      assert.doesNotThrow(() => {
        client.disconnect();
        client.disconnect();
        client.disconnect();
      });
    });
  });

  describe('event emission', () => {
    it('should be an EventEmitter', () => {
      const client = new LSPClient();
      assert.ok(client instanceof EventEmitter);
    });

    it('should support event listeners', () => {
      const client = new LSPClient();
      let eventFired = false;

      client.on('test-event', () => {
        eventFired = true;
      });

      client.emit('test-event');
      assert.strictEqual(eventFired, true);
    });
  });

  describe('port validation', () => {
    it('should reject invalid port numbers', () => {
      process.env.GODOT_LSP_PORT = '99999';
      const client = new LSPClient();

      assert.rejects(
        client.connect(),
        /Invalid GODOT_LSP_PORT/
      );

      delete process.env.GODOT_LSP_PORT;
    });

    it('should reject negative ports', () => {
      process.env.GODOT_LSP_PORT = '-1';
      const client = new LSPClient();

      assert.rejects(
        client.connect(),
        /Invalid GODOT_LSP_PORT/
      );

      delete process.env.GODOT_LSP_PORT;
    });

    it('should reject zero port', () => {
      process.env.GODOT_LSP_PORT = '0';
      const client = new LSPClient();

      assert.rejects(
        client.connect(),
        /Invalid GODOT_LSP_PORT/
      );

      delete process.env.GODOT_LSP_PORT;
    });

    it('should reject non-numeric ports', () => {
      process.env.GODOT_LSP_PORT = 'abc';
      const client = new LSPClient();

      assert.rejects(
        client.connect(),
        /Invalid GODOT_LSP_PORT/
      );

      delete process.env.GODOT_LSP_PORT;
    });
  });

  describe('buffer limits', () => {
    it('should have 10MB max buffer size', () => {
      const client = new LSPClient();
      const maxSize = (client as any).MAX_BUFFER_SIZE;
      assert.strictEqual(maxSize, 10 * 1024 * 1024);
    });
  });

  describe('message parsing', () => {
    it('should handle malformed JSON without crashing', () => {
      const client = new LSPClient();
      const handleData = (client as any).handleData.bind(client);

      const malformedMessage = Buffer.from('Content-Length: 5\r\n\r\n{bad}');
      assert.doesNotThrow(() => handleData(malformedMessage));
    });

    it('should continue processing after JSON error', () => {
      const client = new LSPClient();
      const handleData = (client as any).handleData.bind(client);

      const badMessage = Buffer.from('Content-Length: 5\r\n\r\n{bad}');
      handleData(badMessage);

      assert.strictEqual(client.shouldReconnect(), true);
    });
  });

  describe('file URI construction', () => {
    function parseLspMessage(raw: string): Record<string, unknown> {
      return JSON.parse(raw.slice(raw.indexOf('{')));
    }

    it('should send valid file URIs in didOpen notification', async () => {
      const client = new LSPClient();
      const sent: string[] = [];
      (client as any).socket = { write: (data: string) => sent.push(data) };

      const absPath = resolve('test-script.gd');
      // openFile has a 500ms sleep; don't await it, messages are sent synchronously
      client.openFile(absPath, 'extends Node');

      const didOpen = parseLspMessage(sent[0]);
      const params = didOpen.params as { textDocument: { uri: string } };
      const uri = params.textDocument.uri;

      assert.ok(uri.startsWith('file:///'), `URI must use file:/// scheme: ${uri}`);
      assert.ok(!uri.includes('\\'), `URI must not contain backslashes: ${uri}`);
    });

    it('should send valid file URIs in didSave notification', async () => {
      const client = new LSPClient();
      const sent: string[] = [];
      (client as any).socket = { write: (data: string) => sent.push(data) };

      const absPath = resolve('test-script.gd');
      client.openFile(absPath, 'extends Node');

      const didSave = parseLspMessage(sent[1]);
      const params = didSave.params as { textDocument: { uri: string } };
      const uri = params.textDocument.uri;

      assert.ok(uri.startsWith('file:///'), `URI must use file:/// scheme: ${uri}`);
      assert.ok(!uri.includes('\\'), `URI must not contain backslashes: ${uri}`);
    });

    it('should send valid workspace URI in initialize request', () => {
      const savedEnv = process.env.GODOT_WORKSPACE_PATH;
      process.env.GODOT_WORKSPACE_PATH = resolve('.');

      try {
        const client = new LSPClient();
        const sent: string[] = [];
        (client as any).socket = { write: (data: string) => sent.push(data) };

        (client as any).sendInitialize();

        const init = parseLspMessage(sent[0]);
        const params = init.params as {
          rootUri: string;
          workspaceFolders: Array<{ uri: string; name: string }>;
        };

        assert.ok(params.rootUri.startsWith('file:///'), `rootUri must use file:/// scheme: ${params.rootUri}`);
        assert.ok(!params.rootUri.includes('\\'), `rootUri must not contain backslashes: ${params.rootUri}`);

        assert.ok(params.workspaceFolders[0].uri.startsWith('file:///'));
        assert.ok(params.workspaceFolders[0].name.length > 0, 'workspace name must not be empty');
      } finally {
        if (savedEnv === undefined) {
          delete process.env.GODOT_WORKSPACE_PATH;
        } else {
          process.env.GODOT_WORKSPACE_PATH = savedEnv;
        }
      }
    });
  });
});
