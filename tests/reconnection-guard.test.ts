import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LSPClient } from '../src/lsp-client.js';

describe('Reconnection Guard Logic', () => {
  describe('connection state management', () => {
    it('should track shutdown state correctly', () => {
      const client = new LSPClient();

      // Before disconnect
      assert.strictEqual(
        client.shouldReconnect(),
        true,
        'should allow reconnection before shutdown'
      );

      // After disconnect
      client.disconnect();
      assert.strictEqual(
        client.shouldReconnect(),
        false,
        'should prevent reconnection after shutdown'
      );
    });

    it('should prevent multiple reconnection loops', async () => {
      const client = new LSPClient();
      let reconnectAttempts = 0;
      const maxAttempts = 3;

      // Simulate reconnection guard logic
      let isReconnecting = false;

      const attemptReconnect = () => {
        // Guard: skip if shutting down or already reconnecting
        if (!client.shouldReconnect() || isReconnecting) {
          return false;
        }

        isReconnecting = true;
        reconnectAttempts++;
        return true;
      };

      // First attempt should succeed
      assert.strictEqual(attemptReconnect(), true, 'first attempt should succeed');
      assert.strictEqual(reconnectAttempts, 1);

      // Second attempt should be blocked (already reconnecting)
      assert.strictEqual(attemptReconnect(), false, 'second attempt should be blocked');
      assert.strictEqual(reconnectAttempts, 1, 'should not increment attempts');

      // Third attempt should also be blocked
      assert.strictEqual(attemptReconnect(), false, 'third attempt should be blocked');
      assert.strictEqual(reconnectAttempts, 1, 'should still be 1 attempt');

      // Reset flag and try again
      isReconnecting = false;
      assert.strictEqual(attemptReconnect(), true, 'should allow retry after reset');
      assert.strictEqual(reconnectAttempts, 2);

      // Shutdown and verify blocking
      isReconnecting = false;
      client.disconnect();
      assert.strictEqual(
        attemptReconnect(),
        false,
        'should block after shutdown'
      );
      assert.strictEqual(reconnectAttempts, 2, 'should not increment after shutdown');
    });

    it('should check shouldReconnect before starting reconnection', () => {
      const client = new LSPClient();

      // Simulate the reconnection check
      const canReconnect = () => client.shouldReconnect();

      assert.strictEqual(canReconnect(), true, 'should allow before disconnect');

      client.disconnect();

      assert.strictEqual(canReconnect(), false, 'should block after disconnect');
    });
  });

  describe('timer management', () => {
    it('should handle timer cleanup scenario', (t, done) => {
      // Simulate reconnection timer logic
      let timerCleared = false;
      let timerFired = false;
      let reconnectTimer: NodeJS.Timeout | null = null;

      const startReconnection = () => {
        reconnectTimer = setTimeout(() => {
          timerFired = true;
        }, 10);
      };

      const cleanup = () => {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
          timerCleared = true;
        }
      };

      // Start reconnection
      startReconnection();
      assert.ok(reconnectTimer !== null, 'timer should be set');

      // Cleanup before timer fires
      cleanup();
      assert.strictEqual(timerCleared, true, 'timer should be cleared');

      // Wait to ensure timer doesn't fire
      setTimeout(() => {
        assert.strictEqual(timerFired, false, 'timer should not have fired');
        done();
      }, 50);
    });

    it('should allow timer to be set to null after cleanup', () => {
      let reconnectTimer: NodeJS.Timeout | null = setTimeout(() => {}, 1000);

      assert.ok(reconnectTimer !== null, 'timer should be set');

      clearTimeout(reconnectTimer);
      reconnectTimer = null;

      assert.strictEqual(reconnectTimer, null, 'timer should be null after cleanup');
    });
  });

  describe('close event handling', () => {
    it('should check shutdown state when close event fires', () => {
      const client = new LSPClient();
      let closeEventCount = 0;
      let reconnectionAttempts = 0;

      // Simulate close event handler
      const onClose = () => {
        closeEventCount++;

        // This is the guard logic from index.ts
        if (!client.shouldReconnect()) {
          return;
        }

        reconnectionAttempts++;
      };

      // First close: should attempt reconnection
      onClose();
      assert.strictEqual(closeEventCount, 1, 'close event fired once');
      assert.strictEqual(reconnectionAttempts, 1, 'should attempt reconnection');

      // Second close: should attempt reconnection again
      onClose();
      assert.strictEqual(closeEventCount, 2, 'close event fired twice');
      assert.strictEqual(reconnectionAttempts, 2, 'should attempt reconnection again');

      // Shutdown
      client.disconnect();

      // Third close after shutdown: should NOT attempt reconnection
      onClose();
      assert.strictEqual(closeEventCount, 3, 'close event fired third time');
      assert.strictEqual(
        reconnectionAttempts,
        2,
        'should NOT attempt reconnection after shutdown'
      );
    });
  });

  describe('cleanup idempotency', () => {
    it('should handle multiple cleanup calls safely', () => {
      const client = new LSPClient();
      let cleanupCount = 0;
      let cleanupCalled = false;

      const cleanup = () => {
        if (cleanupCalled) return;
        cleanupCalled = true;
        cleanupCount++;
        client.disconnect();
      };

      // Call cleanup multiple times
      cleanup();
      cleanup();
      cleanup();

      assert.strictEqual(cleanupCount, 1, 'cleanup should only execute once');
      assert.strictEqual(cleanupCalled, true, 'cleanup flag should be set');
    });

    it('should prevent timer from running after cleanup', (t, done) => {
      let timerExecuted = false;
      let cleanupCalled = false;
      let timer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (cleanupCalled) return;
        cleanupCalled = true;

        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

      // Start timer
      timer = setTimeout(() => {
        timerExecuted = true;
      }, 10);

      // Cleanup immediately
      cleanup();

      // Verify timer was cancelled
      setTimeout(() => {
        assert.strictEqual(timerExecuted, false, 'timer should not execute');
        assert.strictEqual(cleanupCalled, true, 'cleanup should be called');
        done();
      }, 50);
    });
  });
});
