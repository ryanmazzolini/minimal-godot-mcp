import { Socket } from 'net';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { LSPPublishDiagnosticsParams } from './types.js';
import { DiagnosticCache, transformDiagnostics } from './diagnostics.js';

/**
 * LSP Client for connecting to Godot's Language Server
 */
export class LSPClient extends EventEmitter {
  private socket: Socket | null = null;
  private cache = new DiagnosticCache();
  private buffer = '';
  private readonly host: string;
  private workspacePath: string | null = null;
  private readonly debug: boolean;
  private isShuttingDown = false;
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
   * Get Godot LSP ports to try (env var, then defaults)
   */
  private getPortsToTry(): number[] {
    const envPort = process.env.GODOT_LSP_PORT;
    if (envPort) {
      const port = parseInt(envPort, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid GODOT_LSP_PORT: ${envPort} (must be 1-65535)`);
      }
      return [port];
    }
    return [6007, 6005, 6008]; // Try 6007 first (Godot 4.x), then others
  }

  /**
   * Connect to Godot LSP server (tries multiple ports)
   */
  async connect(): Promise<void> {
    const ports = this.getPortsToTry();

    for (const port of ports) {
      try {
        await this.tryConnect(port);
        console.error(`Connected to Godot LSP on port ${port}`);
        return;
      } catch {
        // Try next port
      }
    }

    throw new Error(`Could not connect to Godot LSP on any port: ${ports.join(', ')}`);
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
        // Only clear this.socket if THIS socket is closing (not a previous attempt)
        if (this.socket === socket) {
          this.emit('close');
          this.socket = null;
        }
      });

      socket.connect(port, this.host, () => {
        this.sendInitialize();
        resolve();
      });
    });
  }

  /**
   * Disconnect from LSP server
   */
  disconnect(): void {
    this.isShuttingDown = true;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
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
    const uri = `file://${filePath}`;

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
    const workspaceUri = workspacePath ? `file://${workspacePath}` : null;
    const workspaceName = workspacePath ? workspacePath.split('/').pop() : undefined;

    const initializeRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        processId: process.pid,
        clientInfo: {
          name: 'godot-server-mcp',
          version: '0.1.0',
        },
        rootUri: workspaceUri,
        workspaceFolders: workspaceUri ? [
          {
            uri: workspaceUri,
            name: workspaceName,
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
    const header = `Content-Length: ${content.length}\r\n\r\n`;
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
        this.handleMessage(JSON.parse(messageContent));
      } catch (err) {
        console.error('[LSP] Failed to parse message:', err);
      }
    }
  }

  /**
   * Handle parsed LSP message
   */
  private handleMessage(message: { id?: number; method?: string; params?: unknown; result?: unknown }): void {
    this.log('Message:', message.method || `response(id=${message.id})`);

    // Handle initialize response - must send initialized notification
    if (message.id === 1 && message.result) {
      this.log('Sending initialized notification');
      this.sendMessage({
        jsonrpc: '2.0',
        method: 'initialized',
        params: {},
      });
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

    const filePath = fileURLToPath(params.uri);

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
