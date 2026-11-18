import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { LSPSession, getLSPIdleTimeoutMs } from '../src/lsp-session.js';

function stubClient(options: { refuse?: boolean } = {}) {
  const calls = { connect: 0, release: 0 };
  return {
    calls,
    client: {
      connect: async (): Promise<void> => {
        calls.connect++;
        if (options.refuse === true) throw new Error('ECONNREFUSED');
      },
      release: (): void => {
        calls.release++;
      },
    },
  };
}

function silenceStderr(t: TestContext): string[] {
  const lines: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => lines.push(args.join(' ')));
  return lines;
}

describe('LSPSession', () => {
  it('connects on the first call and passes the result to it', async (t) => {
    silenceStderr(t);
    const { client, calls } = stubClient();
    const session = new LSPSession(client, 1000);
    t.after(() => session.dispose());

    const connected = await session.run(async (isConnected) => isConnected);

    assert.equal(connected, true);
    assert.equal(calls.connect, 1);
  });

  it('reports a refused connection to the call, and logs it once', async (t) => {
    const logs = silenceStderr(t);
    const { client } = stubClient({ refuse: true });
    const session = new LSPSession(client, 1000);
    t.after(() => session.dispose());

    assert.equal(await session.run(async (isConnected) => isConnected), false);
    assert.equal(await session.run(async (isConnected) => isConnected), false);

    assert.equal(logs.filter((line) => line.includes('Godot LSP unavailable')).length, 1);
  });

  it('releases the connection once the idle timeout passes after the last call', async (t) => {
    silenceStderr(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { client, calls } = stubClient();
    const session = new LSPSession(client, 1000);

    await session.run(async () => undefined);
    t.mock.timers.tick(999);
    assert.equal(calls.release, 0);
    t.mock.timers.tick(1);

    assert.equal(calls.release, 1);
  });

  it('does not release while a call is still running', async (t) => {
    silenceStderr(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { client, calls } = stubClient();
    const session = new LSPSession(client, 1000);
    let finishLongCall: () => void = () => {};
    const longCall = session.run(() => new Promise<void>((resolve) => (finishLongCall = resolve)));

    await session.run(async () => undefined);
    t.mock.timers.tick(5000);
    assert.equal(calls.release, 0);

    finishLongCall();
    await longCall;
    t.mock.timers.tick(1000);
    assert.equal(calls.release, 1);
  });

  it('restarts the idle timeout on each call', async (t) => {
    silenceStderr(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { client, calls } = stubClient();
    const session = new LSPSession(client, 1000);

    await session.run(async () => undefined);
    t.mock.timers.tick(800);
    await session.run(async () => undefined);
    t.mock.timers.tick(800);
    assert.equal(calls.release, 0);
    t.mock.timers.tick(200);

    assert.equal(calls.release, 1);
  });

  it('never releases with a timeout of 0', async (t) => {
    silenceStderr(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { client, calls } = stubClient();
    const session = new LSPSession(client, 0);

    await session.run(async () => undefined);
    t.mock.timers.tick(10 * 60 * 1000);

    assert.equal(calls.release, 0);
  });

  it('does not release after dispose()', async (t) => {
    silenceStderr(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { client, calls } = stubClient();
    const session = new LSPSession(client, 1000);

    await session.run(async () => undefined);
    session.dispose();
    t.mock.timers.tick(1000);

    assert.equal(calls.release, 0);
  });
});

describe('getLSPIdleTimeoutMs', () => {
  function withEnv(t: TestContext, value: string | undefined): void {
    const saved = process.env.GODOT_LSP_IDLE_TIMEOUT;
    if (value === undefined) delete process.env.GODOT_LSP_IDLE_TIMEOUT;
    else process.env.GODOT_LSP_IDLE_TIMEOUT = value;
    t.after(() => {
      if (saved === undefined) delete process.env.GODOT_LSP_IDLE_TIMEOUT;
      else process.env.GODOT_LSP_IDLE_TIMEOUT = saved;
    });
  }

  it('defaults to 300 seconds', (t) => {
    withEnv(t, undefined);
    assert.equal(getLSPIdleTimeoutMs(), 300_000);
  });

  it('accepts fractional seconds and 0', (t) => {
    withEnv(t, '0.5');
    assert.equal(getLSPIdleTimeoutMs(), 500);
    process.env.GODOT_LSP_IDLE_TIMEOUT = '0';
    assert.equal(getLSPIdleTimeoutMs(), 0);
  });

  it('falls back to the default for invalid values', (t) => {
    const logs = silenceStderr(t);
    withEnv(t, 'soon');
    assert.equal(getLSPIdleTimeoutMs(), 300_000);
    process.env.GODOT_LSP_IDLE_TIMEOUT = '-1';
    assert.equal(getLSPIdleTimeoutMs(), 300_000);
    assert.equal(logs.length, 2);
  });
});
