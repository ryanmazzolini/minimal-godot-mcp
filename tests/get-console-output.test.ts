import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { getConsoleOutput } from '../src/tools/get-console-output.js';
import { ConsoleManager } from '../src/console-manager.js';

describe('get_console_output tool', () => {
  let consoleManager: ConsoleManager;

  beforeEach(() => {
    consoleManager = new ConsoleManager();
    consoleManager.addOutput({ category: 'console', output: 'print message' });
    consoleManager.addOutput({ category: 'stderr', output: 'error message' });
  });

  it('should return console output entries', () => {
    const result = getConsoleOutput(consoleManager, true, {});

    assert.strictEqual(result.entries.length, 2);
    assert.strictEqual(result.entries[0].message, 'print message');
    assert.strictEqual(result.entries[1].message, 'error message');
    assert.strictEqual(result.error, undefined);
  });

  it('should return total_buffered count', () => {
    const result = getConsoleOutput(consoleManager, true, {});

    assert.strictEqual(result.total_buffered, 2);
  });

  it('should filter by category', () => {
    const result = getConsoleOutput(consoleManager, true, { category: 'stderr' });

    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.entries[0].message, 'error message');
  });

  it('should limit results', () => {
    const result = getConsoleOutput(consoleManager, true, { limit: 1 });

    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.entries[0].message, 'error message');
  });

  it('should filter by timestamp', () => {
    const futureTime = Date.now() + 10000;
    const result = getConsoleOutput(consoleManager, true, { since: futureTime });

    assert.strictEqual(result.entries.length, 0);
  });

  it('should return error when no debug session', () => {
    const result = getConsoleOutput(consoleManager, false, {});

    assert.deepStrictEqual(result.entries, []);
    assert.strictEqual(result.total_buffered, 0);
    assert.match(result.error ?? '', /No active debug session/);
  });

  it('should reject invalid category', () => {
    assert.throws(
      () => getConsoleOutput(consoleManager, true, { category: 'invalid' as any }),
      /Invalid category/
    );
  });

  it('should reject negative limit', () => {
    assert.throws(
      () => getConsoleOutput(consoleManager, true, { limit: -1 }),
      /limit must be a non-negative number/
    );
  });

  it('should reject non-numeric limit', () => {
    assert.throws(
      () => getConsoleOutput(consoleManager, true, { limit: 'ten' as any }),
      /limit must be a non-negative number/
    );
  });

  it('should reject negative since timestamp', () => {
    assert.throws(
      () => getConsoleOutput(consoleManager, true, { since: -1 }),
      /since must be a non-negative timestamp/
    );
  });

  it('should accept zero limit', () => {
    const result = getConsoleOutput(consoleManager, true, { limit: 0 });
    // Zero limit means no limit applied (all entries returned)
    assert.strictEqual(result.entries.length, 2);
  });
});
