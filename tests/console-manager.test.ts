import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { ConsoleManager } from '../src/console-manager.js';
import { DAPOutputEventBody } from '../src/types.js';

describe('ConsoleManager', () => {
  describe('buffer management', () => {
    it('should add output entries', () => {
      const manager = new ConsoleManager();

      manager.addOutput({
        category: 'console',
        output: 'test message',
      });

      const entries = manager.getOutput();
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].message, 'test message');
      assert.strictEqual(entries[0].category, 'console');
    });

    it('should add timestamp to entries', () => {
      const manager = new ConsoleManager();
      const before = Date.now();

      manager.addOutput({
        category: 'console',
        output: 'test',
      });

      const after = Date.now();
      const entries = manager.getOutput();

      assert.ok(entries[0].timestamp >= before);
      assert.ok(entries[0].timestamp <= after);
    });

    it('should store source and line information', () => {
      const manager = new ConsoleManager();

      manager.addOutput({
        category: 'console',
        output: 'test',
        source: { path: '/project/script.gd', name: 'script.gd' },
        line: 42,
      });

      const entries = manager.getOutput();
      assert.strictEqual(entries[0].source, '/project/script.gd');
      assert.strictEqual(entries[0].line, 42);
    });

    it('should use source name when path is not available', () => {
      const manager = new ConsoleManager();

      manager.addOutput({
        category: 'console',
        output: 'test',
        source: { name: 'script.gd' },
      });

      const entries = manager.getOutput();
      assert.strictEqual(entries[0].source, 'script.gd');
    });
  });

  describe('buffer limits', () => {
    it('should respect max size', () => {
      const manager = new ConsoleManager(3);

      for (let i = 0; i < 5; i++) {
        manager.addOutput({
          category: 'console',
          output: `message ${i}`,
        });
      }

      assert.strictEqual(manager.size(), 3);
      const entries = manager.getOutput();
      assert.strictEqual(entries[0].message, 'message 2');
      assert.strictEqual(entries[1].message, 'message 3');
      assert.strictEqual(entries[2].message, 'message 4');
    });

    it('should use default max size of 1000', () => {
      const manager = new ConsoleManager();
      assert.strictEqual(manager.getMaxSize(), 1000);
    });

    it('should use env var for max size', () => {
      process.env.GODOT_DAP_BUFFER_SIZE = '500';
      const manager = new ConsoleManager();
      assert.strictEqual(manager.getMaxSize(), 500);
      delete process.env.GODOT_DAP_BUFFER_SIZE;
    });

    it('should ignore invalid env var', () => {
      process.env.GODOT_DAP_BUFFER_SIZE = 'invalid';
      const manager = new ConsoleManager();
      assert.strictEqual(manager.getMaxSize(), 1000);
      delete process.env.GODOT_DAP_BUFFER_SIZE;
    });
  });

  describe('filtering', () => {
    let manager: ConsoleManager;

    beforeEach(() => {
      manager = new ConsoleManager();
      manager.addOutput({ category: 'console', output: 'console message' });
      manager.addOutput({ category: 'stdout', output: 'stdout message' });
      manager.addOutput({ category: 'stderr', output: 'stderr message' });
    });

    it('should filter by category', () => {
      const entries = manager.getOutput({ category: 'console' });
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].message, 'console message');
    });

    it('should filter by stderr category', () => {
      const entries = manager.getOutput({ category: 'stderr' });
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].message, 'stderr message');
    });

    it('should limit results', () => {
      const entries = manager.getOutput({ limit: 2 });
      assert.strictEqual(entries.length, 2);
      // Should return most recent entries
      assert.strictEqual(entries[0].message, 'stdout message');
      assert.strictEqual(entries[1].message, 'stderr message');
    });

    it('should filter by timestamp', () => {
      const timestamp = Date.now() + 1000; // Future timestamp
      const entries = manager.getOutput({ since: timestamp });
      assert.strictEqual(entries.length, 0);
    });

    it('should combine filters', () => {
      manager.addOutput({ category: 'console', output: 'console 2' });
      manager.addOutput({ category: 'console', output: 'console 3' });

      const entries = manager.getOutput({ category: 'console', limit: 1 });
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].message, 'console 3');
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      const manager = new ConsoleManager();
      manager.addOutput({ category: 'console', output: 'test' });
      manager.addOutput({ category: 'console', output: 'test 2' });

      assert.strictEqual(manager.size(), 2);

      manager.clear();

      assert.strictEqual(manager.size(), 0);
      assert.deepStrictEqual(manager.getOutput(), []);
    });

    it('should be safe to clear empty buffer', () => {
      const manager = new ConsoleManager();
      assert.doesNotThrow(() => manager.clear());
      assert.strictEqual(manager.size(), 0);
    });
  });

  describe('size', () => {
    it('should return current buffer size', () => {
      const manager = new ConsoleManager();

      assert.strictEqual(manager.size(), 0);

      manager.addOutput({ category: 'console', output: 'test' });
      assert.strictEqual(manager.size(), 1);

      manager.addOutput({ category: 'console', output: 'test 2' });
      assert.strictEqual(manager.size(), 2);
    });
  });
});
