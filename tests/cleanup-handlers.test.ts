import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LSPClient } from '../src/lsp-client.js';

describe('Cleanup Handler Logic', () => {
  describe('cleanup function behavior', () => {
    it('should only execute once when called multiple times', () => {
      const client = new LSPClient();
      let cleanupExecutions = 0;
      let cleanupCalled = false;

      const cleanup = (signal: string) => {
        if (cleanupCalled) return;
        cleanupCalled = true;

        cleanupExecutions++;
        client.disconnect();
      };

      // Call cleanup multiple times with different signals
      cleanup('SIGINT');
      cleanup('SIGTERM');
      cleanup('SIGHUP');
      cleanup('beforeExit');

      assert.strictEqual(cleanupExecutions, 1, 'cleanup should execute exactly once');
      assert.strictEqual(client.shouldReconnect(), false, 'client should be shut down');
    });

    it('should clear reconnection timer during cleanup', () => {
      let reconnectTimer: NodeJS.Timeout | null = setTimeout(() => {}, 5000);
      let timerCleared = false;

      const cleanup = () => {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
          timerCleared = true;
        }
      };

      cleanup();

      assert.strictEqual(timerCleared, true, 'timer should be cleared');
      assert.strictEqual(reconnectTimer, null, 'timer reference should be null');
    });

    it('should reset reconnection flag during cleanup', () => {
      let isReconnecting = true;

      const cleanup = () => {
        isReconnecting = false;
      };

      cleanup();

      assert.strictEqual(isReconnecting, false, 'reconnection flag should be reset');
    });

    it('should disconnect LSP client during cleanup', () => {
      const client = new LSPClient();

      const cleanup = () => {
        client.disconnect();
      };

      cleanup();

      assert.strictEqual(
        client.shouldReconnect(),
        false,
        'client should be shut down'
      );
    });
  });

  describe('comprehensive cleanup sequence', () => {
    it('should perform full cleanup in correct order', () => {
      const client = new LSPClient();
      let reconnectTimer: NodeJS.Timeout | null = setTimeout(() => {}, 5000);
      let isReconnecting = true;
      let cleanupCalled = false;

      const steps: string[] = [];

      const cleanup = (signal: string) => {
        if (cleanupCalled) {
          steps.push('guard:skip');
          return;
        }
        cleanupCalled = true;
        steps.push('guard:pass');

        // Stop reconnection loop
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
          steps.push('timer:cleared');
        }
        isReconnecting = false;
        steps.push('flag:reset');

        // Disconnect LSP client
        client.disconnect();
        steps.push('client:disconnected');
      };

      // First cleanup
      cleanup('SIGINT');

      assert.deepStrictEqual(
        steps,
        [
          'guard:pass',
          'timer:cleared',
          'flag:reset',
          'client:disconnected',
        ],
        'cleanup steps should execute in order'
      );

      // Second cleanup should be skipped
      cleanup('SIGTERM');

      assert.strictEqual(
        steps[steps.length - 1],
        'guard:skip',
        'second cleanup should be guarded'
      );
    });

    it('should handle cleanup with null timer gracefully', () => {
      const client = new LSPClient();
      let reconnectTimer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        client.disconnect();
      };

      // Should not throw when timer is null
      assert.doesNotThrow(() => cleanup());
      assert.strictEqual(client.shouldReconnect(), false);
    });

    it('should handle cleanup when already disconnected', () => {
      const client = new LSPClient();

      // Disconnect first
      client.disconnect();

      const cleanup = () => {
        client.disconnect(); // Call disconnect again
      };

      // Should not throw
      assert.doesNotThrow(() => cleanup());
      assert.strictEqual(client.shouldReconnect(), false);
    });
  });

  describe('signal handler scenarios', () => {
    it('should support multiple signal types', () => {
      const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'beforeExit', 'stdin-close'];
      const receivedSignals: string[] = [];

      const cleanup = (signal: string) => {
        receivedSignals.push(signal);
      };

      signals.forEach((signal) => cleanup(signal));

      assert.deepStrictEqual(receivedSignals, signals, 'all signals should be handled');
    });

    it('should prevent cleanup from running twice on multiple signals', () => {
      let cleanupCalled = false;
      let executionCount = 0;

      const cleanup = () => {
        if (cleanupCalled) return;
        cleanupCalled = true;
        executionCount++;
      };

      // Simulate multiple signals arriving
      cleanup(); // SIGINT
      cleanup(); // SIGTERM
      cleanup(); // SIGHUP

      assert.strictEqual(executionCount, 1, 'should only execute once');
    });
  });

  describe('state consistency', () => {
    it('should ensure all state is cleaned up', () => {
      const client = new LSPClient();
      let reconnectTimer: NodeJS.Timeout | null = setTimeout(() => {}, 1000);
      let isReconnecting = true;
      let cleanupCalled = false;

      const cleanup = () => {
        if (cleanupCalled) return;
        cleanupCalled = true;

        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        isReconnecting = false;
        client.disconnect();
      };

      cleanup();

      // Verify all state is clean
      assert.strictEqual(cleanupCalled, true, 'cleanup flag should be set');
      assert.strictEqual(reconnectTimer, null, 'timer should be null');
      assert.strictEqual(isReconnecting, false, 'reconnecting flag should be false');
      assert.strictEqual(client.shouldReconnect(), false, 'client should not reconnect');
    });

    it('should maintain idempotency across multiple cleanup attempts', () => {
      const client = new LSPClient();
      let reconnectTimer: NodeJS.Timeout | null = setTimeout(() => {}, 1000);
      let cleanupCalled = false;
      let disconnectCalls = 0;

      const cleanup = () => {
        if (cleanupCalled) return;
        cleanupCalled = true;

        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }

        // Track disconnect calls
        if (!client.shouldReconnect()) {
          disconnectCalls++;
        } else {
          client.disconnect();
          disconnectCalls++;
        }
      };

      // Multiple cleanup calls
      for (let i = 0; i < 5; i++) {
        cleanup();
      }

      assert.strictEqual(disconnectCalls, 1, 'disconnect should only be called once');
      assert.strictEqual(client.shouldReconnect(), false, 'client should be shut down');
    });
  });
});
