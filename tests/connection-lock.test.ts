import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('connection lock pattern', () => {
  it('should prevent concurrent connection attempts', async () => {
    let connectCalls = 0;
    let connecting: Promise<boolean> | null = null;

    // Simulate slow connection
    const connect = async (): Promise<boolean> => {
      connectCalls++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return true;
    };

    // Same pattern used in index.ts
    const tryConnect = async (): Promise<boolean> => {
      if (connecting) return connecting;

      connecting = connect();

      try {
        return await connecting;
      } finally {
        connecting = null;
      }
    };

    // Call concurrently
    const [result1, result2, result3] = await Promise.all([
      tryConnect(),
      tryConnect(),
      tryConnect(),
    ]);

    assert.strictEqual(result1, true);
    assert.strictEqual(result2, true);
    assert.strictEqual(result3, true);
    assert.strictEqual(connectCalls, 1, 'connect should only be called once');
  });

  it('should allow new connection after previous completes', async () => {
    let connectCalls = 0;
    let connecting: Promise<boolean> | null = null;

    const connect = async (): Promise<boolean> => {
      connectCalls++;
      return true;
    };

    const tryConnect = async (): Promise<boolean> => {
      if (connecting) return connecting;

      connecting = connect();

      try {
        return await connecting;
      } finally {
        connecting = null;
      }
    };

    await tryConnect();
    await tryConnect();

    assert.strictEqual(connectCalls, 2, 'sequential calls should each connect');
  });

  it('should propagate errors to all waiters', async () => {
    let connecting: Promise<boolean> | null = null;

    const connect = async (): Promise<boolean> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error('connection failed');
    };

    const tryConnect = async (): Promise<boolean> => {
      if (connecting) return connecting;

      connecting = connect();

      try {
        return await connecting;
      } finally {
        connecting = null;
      }
    };

    const results = await Promise.allSettled([
      tryConnect(),
      tryConnect(),
    ]);

    assert.strictEqual(results[0].status, 'rejected');
    assert.strictEqual(results[1].status, 'rejected');
  });
});
