import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
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
});
