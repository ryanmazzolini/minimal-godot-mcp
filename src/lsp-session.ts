import { LSPClient } from './lsp-client.js';

const DEFAULT_IDLE_TIMEOUT_SECONDS = 300;

/**
 * GODOT_LSP_IDLE_TIMEOUT: seconds without a diagnostics call before the LSP
 * connection is released. 0 keeps the connection open once made.
 */
export function getLSPIdleTimeoutMs(): number {
  const value = process.env.GODOT_LSP_IDLE_TIMEOUT;
  if (value === undefined || value === '') return DEFAULT_IDLE_TIMEOUT_SECONDS * 1000;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    console.error(
      `Invalid GODOT_LSP_IDLE_TIMEOUT: ${value} (expected seconds >= 0). ` +
        `Using ${DEFAULT_IDLE_TIMEOUT_SECONDS}.`
    );
    return DEFAULT_IDLE_TIMEOUT_SECONDS * 1000;
  }
  return seconds * 1000;
}

/**
 * Holds the LSP connection only while diagnostics are in use. Godot accepts
 * at most 8 LSP clients, and MCP hosts may start one server per session, so
 * the connection is made on the first call and released once the last
 * overlapping call has been idle for the timeout.
 */
export class LSPSession {
  private activeCalls = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private failureReported = false;

  constructor(
    private readonly client: Pick<LSPClient, 'connect' | 'release'>,
    private readonly idleTimeoutMs: number
  ) {}

  /** Run a diagnostics call, telling it whether Godot's LSP is reachable. */
  async run<T>(call: (connected: boolean) => Promise<T>): Promise<T> {
    this.activeCalls++;
    this.cancelIdleTimer();
    try {
      return await call(await this.connect());
    } finally {
      this.activeCalls--;
      if (this.activeCalls === 0) this.scheduleRelease();
    }
  }

  dispose(): void {
    this.cancelIdleTimer();
  }

  private async connect(): Promise<boolean> {
    try {
      await this.client.connect();
      this.failureReported = false;
      return true;
    } catch (error) {
      if (!this.failureReported) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `Godot LSP unavailable: ${message}. Will retry on the next diagnostics call.`
        );
        this.failureReported = true;
      }
      return false;
    }
  }

  private scheduleRelease(): void {
    if (this.idleTimeoutMs === 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.client.release();
      console.error('Released idle Godot LSP connection.');
    }, this.idleTimeoutMs);
    this.idleTimer.unref();
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
