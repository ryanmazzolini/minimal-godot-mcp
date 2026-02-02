import { Socket } from 'net';
import { EventEmitter } from 'events';
import { DAPMessage, DAPOutputEventBody } from './types.js';

/**
 * DAP Client for connecting to Godot's Debug Adapter
 * Captures console output (print statements, errors, warnings)
 */
export class DAPClient extends EventEmitter {
  private socket: Socket | null = null;
  private buffer = '';
  private readonly host: string;
  private readonly debug: boolean;
  private isShuttingDown = false;
  private readonly MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB
  private seq = 1;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(host = '127.0.0.1', debug = false) {
    super();
    this.host = host;
    this.debug = debug;
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.error('[DAP]', ...args);
    }
  }

  /**
   * Get Godot DAP ports to try (env var, then default)
   */
  private getPortsToTry(): number[] {
    const envPort = process.env.GODOT_DAP_PORT;
    if (envPort !== undefined && envPort !== '') {
      const port = parseInt(envPort, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid GODOT_DAP_PORT: ${envPort} (must be 1-65535)`);
      }
      return [port];
    }
    return [6006, 6010]; // 6006 for Godot 4.x, 6010 for Godot 3.x
  }

  /**
   * Connect to Godot DAP server (tries multiple ports)
   */
  async connect(port?: number): Promise<void> {
    const ports = port !== undefined ? [port] : this.getPortsToTry();

    for (const p of ports) {
      try {
        await this.tryConnect(p);
        console.error(`Connected to Godot DAP on port ${p}`);
        return;
      } catch {
        // Try next port
      }
    }

    throw new Error(`Could not connect to Godot DAP on any port: ${ports.join(', ')}`);
  }

  /**
   * Try connecting to a specific port
   */
  private async tryConnect(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      this.socket = socket;

      socket.on('data', (data) => {
        this.log('Received', data.length, 'bytes');
        this.handleData(data);
      });

      socket.once('error', reject);

      socket.on('close', () => {
        if (this.socket === socket) {
          this.emit('close');
          this.socket = null;
        }
      });

      socket.connect(port, this.host, async () => {
        try {
          await this.initialize();
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  /**
   * Disconnect from DAP server
   */
  disconnect(): void {
    this.isShuttingDown = true;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    // Reject all pending requests and clear timeouts
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('DAP client disconnected'));
    }
    this.pendingRequests.clear();
  }

  /**
   * Check if reconnection is allowed
   */
  shouldReconnect(): boolean {
    return !this.isShuttingDown;
  }

  /**
   * Check if connected to DAP server
   */
  isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  /**
   * Send DAP initialize and launch requests
   */
  private async initialize(): Promise<void> {
    // Send initialize request
    const initResponse = await this.sendRequest('initialize', {
      clientID: 'godot-server-mcp',
      clientName: 'Godot MCP Server',
      adapterID: 'godot',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsRunInTerminalRequest: false,
    });

    this.log('Initialize response:', initResponse);

    // Send initialized notification (not a request)
    this.sendEvent('initialized');

    // Send launch request to attach to running debug session
    // Use attach mode since Godot is already running
    try {
      await this.sendRequest('attach', {});
      this.log('Attached to debug session');
    } catch {
      // Launch/attach might not be needed for output capture
      this.log('Attach request not supported, continuing anyway');
    }
  }

  /**
   * Send a DAP request and wait for response
   */
  private sendRequest(command: string, args: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const seq = this.seq++;

      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(seq)) {
          this.pendingRequests.delete(seq);
          reject(new Error(`DAP request '${command}' timed out`));
        }
      }, 10000);

      this.pendingRequests.set(seq, { resolve, reject, timeout });

      const message: DAPMessage = {
        seq,
        type: 'request',
        command,
        arguments: args,
      };

      this.sendMessage(message);
    });
  }

  /**
   * Send a DAP event (notification)
   */
  private sendEvent(event: string): void {
    const message: DAPMessage = {
      seq: this.seq++,
      type: 'event',
      event,
    };
    this.sendMessage(message);
  }

  /**
   * Send DAP message
   * @see https://microsoft.github.io/debug-adapter-protocol/overview#base-protocol
   */
  private sendMessage(message: DAPMessage): void {
    if (!this.socket) {
      console.error('[DAP] ERROR: Cannot send message - no socket connection');
      return;
    }

    const content = JSON.stringify(message);
    // Content-Length must be in bytes, not characters (DAP base protocol spec)
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    this.socket.write(header + content);
  }

  /**
   * Handle incoming data from DAP server
   */
  private handleData(data: Buffer): void {
    // Prevent unbounded buffer growth from malformed messages
    if (this.buffer.length + data.length > this.MAX_BUFFER_SIZE) {
      console.error('[DAP] Buffer size exceeded, disconnecting');
      this.disconnect();
      return;
    }

    this.buffer += data.toString();

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length: (\d+)/);

      if (!contentLengthMatch) break;

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (this.buffer.length < messageEnd) break;

      const messageContent = this.buffer.slice(messageStart, messageEnd);
      this.buffer = this.buffer.slice(messageEnd);

      try {
        this.handleMessage(JSON.parse(messageContent) as DAPMessage);
      } catch (err) {
        console.error('[DAP] Failed to parse message:', err);
      }
    }
  }

  /**
   * Handle parsed DAP message
   */
  private handleMessage(message: DAPMessage): void {
    this.log('Message:', message.type, message.event ?? message.command ?? `seq=${message.seq}`);

    // Handle response to our request
    if (message.type === 'response' && message.request_seq !== undefined) {
      const pending = this.pendingRequests.get(message.request_seq);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.request_seq);
        if (message.success === true) {
          pending.resolve(message.body);
        } else {
          pending.reject(new Error(`DAP request failed: ${JSON.stringify(message.body)}`));
        }
      }
      return;
    }

    // Handle output event
    if (message.type === 'event' && message.event === 'output') {
      const body = message.body as DAPOutputEventBody;
      this.emit('output', body);
    }

    // Handle terminated event
    if (message.type === 'event' && message.event === 'terminated') {
      this.log('Debug session terminated');
      this.emit('terminated');
    }
  }
}
