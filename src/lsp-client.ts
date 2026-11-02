import { Socket } from 'net';
import { EventEmitter } from 'events';
import { LSPPublishDiagnosticsParams } from './types.js';
import { DiagnosticCache, transformDiagnostics } from './diagnostics.js';
import { toFileUri, fromFileUri, workspaceName } from './uri-utils.js';

/**
 * LSP Client for connecting to Godot's Language Server
 */
export class LSPClient extends EventEmitter {
  private socket: Socket | null = null;
  private cache = new DiagnosticCache();
  private buffer: Buffer = Buffer.alloc(0);
  private readonly host: string;
  private workspacePath: string | null = null;
  private readonly debug: boolean;
  private isShuttingDown = false;
  private isReady = false;
  private connecting: Promise<void> | null = null;
  private finishInitialize: ((error?: Error) => void) | null = null;
  private readonly MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB

  constructor(host = '127.0.0.1', debug = false) {
    super();
    this.host = host;
    this.debug = debug;
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.error('[LSP]', ...args);
    }
  }

  /**
   * Use Godot's LSP port, or an explicitly configured custom port.
   */
  private getPort(): number {
    const envPort = process.env.GODOT_LSP_PORT;
    if (envPort) {
      const port = parseInt(envPort, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid GODOT_LSP_PORT: ${envPort} (must be 1-65535)`);
      }
      return port;
    }
    return 6005;
  }

  /**
   * Resolve only after Godot accepts initialization and initialized is sent.
   * Concurrent callers share one connection attempt.
   */
  async connect(): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('LSP client has been shut down');
    }
    if (this.isReady && this.socket !== null && !this.socket.destroyed) return;
    if (this.connecting !== null) return this.connecting;

    const port = this.getPort();
    this.connecting = this.tryConnect(port);
    try {
      await this.connecting;
      console.error(`Connected to Godot LSP on port ${port}`);
    } finally {
      this.connecting = null;
    }
  }

  private async tryConnect(port: number): Promise<void> {
    this.socket?.destroy();
    this.isReady = false;
    this.buffer = Buffer.alloc(0);

    return new Promise((resolve, reject) => {
      const socket = new Socket();
      this.socket = socket;
      let settled = false;

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.finishInitialize = null;
        if (error !== undefined) {
          this.socket = null;
          this.buffer = Buffer.alloc(0);
          socket.destroy();
          reject(error);
        } else {
          this.isReady = true;
          resolve();
        }
      };

      // Bound the entire attempt, including a TCP peer that never speaks LSP.
      const timer = setTimeout(() => {
        finish(new Error(`Godot LSP connection/initialization timed out on port ${port}`));
      }, 5000);
      this.finishInitialize = finish;

      socket.on('data', (data: Buffer) => {
        if (this.socket !== socket) return;
        this.log('Received', data.length, 'bytes');
        this.handleData(data);
      });

      socket.on('error', (error) => {
        if (!settled) {
          finish(error);
        } else {
          // Keep the socket current until close so established failures notify callers.
          socket.destroy();
        }
      });

      socket.on('close', () => {
        if (!settled) {
          finish(new Error('Godot LSP connection closed during initialization'));
        }
        if (this.socket === socket) {
          this.socket = null;
          this.isReady = false;
          this.buffer = Buffer.alloc(0);
          this.emit('close');
        }
      });

      socket.connect(port, this.host, () => {
        try {
          this.sendInitialize();
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  /**
   * Disconnect from LSP server
   */
  disconnect(): void {
    this.isShuttingDown = true;
    this.finishInitialize?.(new Error('LSP client disconnected during initialization'));
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.isReady = false;
    this.buffer = Buffer.alloc(0);
    this.cache.clearAll();
  }

  /**
   * Check if reconnection is allowed
   */
  shouldReconnect(): boolean {
    return !this.isShuttingDown;
  }

  /**
   * Open a file in the LSP to request diagnostics
   */
  async openFile(filePath: string, fileContent: string): Promise<void> {
    const uri = toFileUri(filePath);

    const didOpenNotification = {
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri,
          languageId: 'gdscript',
          version: 1,
          text: fileContent,
        },
      },
    };

    this.log('Sending didOpen for:', uri);
    this.sendMessage(didOpenNotification);

    // Godot requires didSave with includeText to trigger diagnostics
    const didSaveNotification = {
      jsonrpc: '2.0',
      method: 'textDocument/didSave',
      params: {
        textDocument: {
          uri,
        },
        text: fileContent,
      },
    };

    this.log('Sending didSave for:', uri);
    this.sendMessage(didSaveNotification);

    // Wait a bit for diagnostics to arrive
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  /**
   * Get diagnostics for a file path
   */
  getDiagnostics(filePath: string) {
    return this.cache.get(filePath);
  }

  /**
   * Get all diagnostics for all files
   */
  getAllDiagnostics() {
    return this.cache.getAll();
  }

  /**
   * Send LSP initialize request
   */
  private sendInitialize(): void {
    // Use environment variable for workspace path, or null to let Godot tell us
    const workspacePath = process.env.GODOT_WORKSPACE_PATH;
    const workspaceUri = workspacePath ? toFileUri(workspacePath) : null;
    const wsName = workspacePath ? workspaceName(workspacePath) : undefined;

    const initializeRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        processId: process.pid,
        clientInfo: {
          name: 'minimal-godot-mcp',
          version: '0.1.0',
        },
        rootUri: workspaceUri,
        workspaceFolders: workspaceUri ? [
          {
            uri: workspaceUri,
            name: wsName,
          },
        ] : null,
        capabilities: {
          textDocument: {
            publishDiagnostics: {},
          },
          workspace: {
            workspaceFolders: true,
          },
        },
      },
    };

    if (workspacePath) {
      this.log('Initializing with workspace:', workspacePath);
    } else {
      this.log('Initializing without workspace (will use Godot notification)');
    }
    this.sendMessage(initializeRequest);
  }

  /**
   * Send LSP message
   */
  private sendMessage(message: unknown): void {
    if (!this.socket) {
      console.error('[LSP] ERROR: Cannot send message - no socket connection');
      return;
    }

    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    this.socket.write(header + content);
  }

  /**
   * Handle incoming data from LSP server
   */
  private handleData(data: Buffer): void {
    // Prevent unbounded buffer growth from malformed messages
    if (this.buffer.length + data.length > this.MAX_BUFFER_SIZE) {
      console.error('[LSP] Buffer size exceeded, disconnecting');
      this.disconnect();
      return;
    }

    // Keep byte offsets intact; a UTF-8 character may span multiple chunks.
    this.buffer = Buffer.concat([this.buffer, data]);

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const contentLengthMatch = header.match(/Content-Length: (\d+)/);

      if (!contentLengthMatch) break;

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (this.buffer.length < messageEnd) break;

      const messageContent = this.buffer.subarray(messageStart, messageEnd).toString('utf8');
      this.buffer = messageEnd === this.buffer.length
        ? Buffer.alloc(0)
        : this.buffer.subarray(messageEnd);

      try {
        this.handleMessage(JSON.parse(messageContent));
      } catch (err) {
        console.error('[LSP] Failed to parse message:', err);
      }
    }
  }

  /**
   * Handle parsed LSP message
   */
  private handleMessage(message: { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown }): void {
    this.log('Message:', message.method || `response(id=${message.id})`);

    if (message.id === 1 && this.finishInitialize !== null) {
      const result = message.result;
      if (message.error !== undefined) {
        this.finishInitialize(new Error('Godot LSP rejected initialization'));
      } else if (
        result === null || typeof result !== 'object' || !('capabilities' in result) ||
        result.capabilities === null || typeof result.capabilities !== 'object' ||
        Array.isArray(result.capabilities)
      ) {
        this.finishInitialize(new Error('Godot LSP returned an invalid initialize result'));
      } else {
        this.log('Sending initialized notification');
        this.sendMessage({
          jsonrpc: '2.0',
          method: 'initialized',
          params: {},
        });
        this.finishInitialize();
      }
    }

    if (message.method === 'textDocument/publishDiagnostics') {
      const params = message.params as LSPPublishDiagnosticsParams;
      this.handlePublishDiagnostics(params);
    }

    if (message.method === 'gdscript_client/changeWorkspace') {
      this.handleWorkspaceChange(message.params);
    }
  }

  /**
   * Handle publishDiagnostics notification
   */
  private handlePublishDiagnostics(params: LSPPublishDiagnosticsParams): void {
    this.log('Diagnostics received:', params.uri, `(${params.diagnostics.length} items)`);

    const filePath = fromFileUri(params.uri);

    // Transform and cache diagnostics
    const diagnostics = transformDiagnostics(params.diagnostics);
    this.cache.set(filePath, diagnostics);

    // Emit event for subscribers
    this.emit('diagnostics', filePath, diagnostics);
  }

  /**
   * Handle workspace change notification from Godot
   */
  private handleWorkspaceChange(params: unknown): void {
    this.log('Workspace changed:', params);

    // Store workspace path
    if (params && typeof params === 'object' && 'path' in params) {
      this.workspacePath = params.path as string;
    }

    // Clear all cached diagnostics when workspace changes
    this.cache.clearAll();

    // Emit workspace change event
    this.emit('workspaceChange', params);
  }

  /**
   * Get current workspace path
   */
  getWorkspacePath(): string | null {
    return this.workspacePath;
  }
}
