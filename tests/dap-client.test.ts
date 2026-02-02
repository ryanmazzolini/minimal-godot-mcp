import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { DAPClient } from '../src/dap-client.js';
import { EventEmitter } from 'events';

describe('DAPClient', () => {
  describe('shutdown behavior', () => {
    it('should set shutdown flag when disconnect is called', () => {
      const client = new DAPClient();

      assert.strictEqual(client.shouldReconnect(), true, 'should allow reconnect initially');

      client.disconnect();

      assert.strictEqual(client.shouldReconnect(), false, 'should not allow reconnect after disconnect');
    });

    it('should prevent reconnection after shutdown', () => {
      const client = new DAPClient();

      client.disconnect();

      assert.strictEqual(client.shouldReconnect(), false);
    });

    it('disconnect should be safe to call multiple times', () => {
      const client = new DAPClient();

      assert.doesNotThrow(() => {
        client.disconnect();
        client.disconnect();
        client.disconnect();
      });
    });
  });

  describe('connection state', () => {
    it('should not be connected initially', () => {
      const client = new DAPClient();
      assert.strictEqual(client.isConnected(), false);
    });

    it('should not be connected after disconnect', () => {
      const client = new DAPClient();
      client.disconnect();
      assert.strictEqual(client.isConnected(), false);
    });
  });

  describe('event emission', () => {
    it('should be an EventEmitter', () => {
      const client = new DAPClient();
      assert.ok(client instanceof EventEmitter);
    });

    it('should support event listeners', () => {
      const client = new DAPClient();
      let eventFired = false;

      client.on('test-event', () => {
        eventFired = true;
      });

      client.emit('test-event');
      assert.strictEqual(eventFired, true);
    });

    it('should emit output events', () => {
      const client = new DAPClient();
      let receivedOutput: unknown = null;

      client.on('output', (event: unknown) => {
        receivedOutput = event;
      });

      const testOutput = { category: 'console', output: 'test message' };
      client.emit('output', testOutput);

      assert.deepStrictEqual(receivedOutput, testOutput);
    });
  });

  describe('port validation', () => {
    afterEach(() => {
      delete process.env.GODOT_DAP_PORT;
    });

    it('should reject invalid port numbers', async () => {
      process.env.GODOT_DAP_PORT = '99999';
      const client = new DAPClient();

      await assert.rejects(
        client.connect(),
        /Invalid GODOT_DAP_PORT/
      );
    });

    it('should reject negative ports', async () => {
      process.env.GODOT_DAP_PORT = '-1';
      const client = new DAPClient();

      await assert.rejects(
        client.connect(),
        /Invalid GODOT_DAP_PORT/
      );
    });

    it('should reject zero port', async () => {
      process.env.GODOT_DAP_PORT = '0';
      const client = new DAPClient();

      await assert.rejects(
        client.connect(),
        /Invalid GODOT_DAP_PORT/
      );
    });

    it('should reject non-numeric ports', async () => {
      process.env.GODOT_DAP_PORT = 'abc';
      const client = new DAPClient();

      await assert.rejects(
        client.connect(),
        /Invalid GODOT_DAP_PORT/
      );
    });
  });

  describe('buffer limits', () => {
    it('should have 10MB max buffer size', () => {
      const client = new DAPClient();
      const maxSize = (client as any).MAX_BUFFER_SIZE;
      assert.strictEqual(maxSize, 10 * 1024 * 1024);
    });
  });

  describe('message sending', () => {
    it('should use byte length for Content-Length header', () => {
      const client = new DAPClient();
      // Create a mock socket to capture what's written
      let writtenData = '';
      const mockSocket = {
        write: (data: string) => { writtenData = data; },
        destroyed: false,
      };
      (client as any).socket = mockSocket;

      // Send a message with multi-byte characters (emoji = 4 bytes, but 2 chars in JS)
      const sendMessage = (client as any).sendMessage.bind(client);
      sendMessage({ seq: 1, type: 'request', command: 'test', arguments: { text: '日本語' } });

      // "日本語" is 3 characters but 9 bytes in UTF-8
      // Verify Content-Length uses byte count, not character count
      const contentLengthMatch = writtenData.match(/Content-Length: (\d+)/);
      assert.ok(contentLengthMatch, 'Should have Content-Length header');

      const headerEnd = writtenData.indexOf('\r\n\r\n');
      const content = writtenData.slice(headerEnd + 4);
      const byteLength = Buffer.byteLength(content);

      assert.strictEqual(parseInt(contentLengthMatch![1], 10), byteLength,
        'Content-Length should match byte length, not character length');
    });
  });

  describe('message parsing', () => {
    it('should handle malformed JSON without crashing', () => {
      const client = new DAPClient();
      const handleData = (client as any).handleData.bind(client);

      const malformedMessage = Buffer.from('Content-Length: 5\r\n\r\n{bad}');
      assert.doesNotThrow(() => handleData(malformedMessage));
    });

    it('should continue processing after JSON error', () => {
      const client = new DAPClient();
      const handleData = (client as any).handleData.bind(client);

      const badMessage = Buffer.from('Content-Length: 5\r\n\r\n{bad}');
      handleData(badMessage);

      assert.strictEqual(client.shouldReconnect(), true);
    });

    it('should parse valid DAP output event', () => {
      const client = new DAPClient();
      const handleData = (client as any).handleData.bind(client);
      let receivedEvent: unknown = null;

      client.on('output', (event: unknown) => {
        receivedEvent = event;
      });

      const outputEvent = {
        seq: 1,
        type: 'event',
        event: 'output',
        body: {
          category: 'console',
          output: 'Hello from Godot',
        },
      };
      const content = JSON.stringify(outputEvent);
      const message = Buffer.from(`Content-Length: ${content.length}\r\n\r\n${content}`);
      handleData(message);

      assert.deepStrictEqual(receivedEvent, {
        category: 'console',
        output: 'Hello from Godot',
      });
    });
  });

  describe('reconnection guard', () => {
    it('shouldReconnect returns true before disconnect', () => {
      const client = new DAPClient();
      assert.strictEqual(client.shouldReconnect(), true);
    });

    it('shouldReconnect returns false after disconnect', () => {
      const client = new DAPClient();
      client.disconnect();
      assert.strictEqual(client.shouldReconnect(), false);
    });

    it('shouldReconnect is idempotent', () => {
      const client = new DAPClient();
      client.disconnect();

      assert.strictEqual(client.shouldReconnect(), false);
      assert.strictEqual(client.shouldReconnect(), false);
      assert.strictEqual(client.shouldReconnect(), false);
    });
  });
});
