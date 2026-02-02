import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { clearConsoleOutput } from '../src/tools/clear-console-output.js';
import { ConsoleManager } from '../src/console-manager.js';

describe('clear_console_output tool', () => {
  let consoleManager: ConsoleManager;

  beforeEach(() => {
    consoleManager = new ConsoleManager();
    consoleManager.addOutput({ category: 'console', output: 'message 1' });
    consoleManager.addOutput({ category: 'console', output: 'message 2' });
  });

  it('should clear all entries', () => {
    assert.strictEqual(consoleManager.size(), 2);

    const result = clearConsoleOutput(consoleManager);

    assert.strictEqual(result.cleared, true);
    assert.strictEqual(consoleManager.size(), 0);
  });

  it('should be safe to clear empty buffer', () => {
    consoleManager.clear();
    assert.strictEqual(consoleManager.size(), 0);

    const result = clearConsoleOutput(consoleManager);

    assert.strictEqual(result.cleared, true);
  });
});
