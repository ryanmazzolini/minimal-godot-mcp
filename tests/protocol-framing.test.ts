import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LSPClient } from '../src/lsp-client.js';
import { DAPClient } from '../src/dap-client.js';

// Exercise the socket callbacks directly so chunk boundaries are deterministic.
interface FramingClient {
  handleData(data: Buffer): void;
  sendMessage(message: unknown): void;
  socket: { write(data: string): void };
}

function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message));
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),
    body,
  ]);
}

const protocols = [
  {
    name: 'LSP',
    create: () => new LSPClient(),
    event: 'diagnostics',
    message: (text: string) => ({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///tmp/framing.gd',
        diagnostics: [{
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          severity: 1,
          message: text,
        }],
      },
    }),
    expected: (text: string) => [{
      line: 1, column: 1, severity: 'error', message: text, code: undefined,
    }],
  },
  {
    name: 'DAP',
    create: () => new DAPClient(),
    event: 'output',
    message: (text: string) => ({
      seq: 1,
      type: 'event',
      event: 'output',
      body: { category: 'stdout', output: text },
    }),
    expected: (text: string) => ({ category: 'stdout', output: text }),
  },
];

for (const protocol of protocols) {
  describe(`${protocol.name} byte framing`, () => {
    function setup() {
      const client = protocol.create();
      const received: unknown[] = [];
      client.on(protocol.event, (...args: unknown[]) => {
        received.push(protocol.event === 'diagnostics' ? args[1] : args[0]);
      });
      return { client, parser: client as unknown as FramingClient, received };
    }

    for (const text of ['plain ASCII', 'café — 日本語 😀']) {
      it(`uses UTF-8 byte length when sending ${text}`, () => {
        const { parser } = setup();
        const sent: string[] = [];
        parser.socket = { write: (data) => { sent.push(data); } };
        const message = protocol.message(text);
        parser.sendMessage(message);
        assert.equal(sent.length, 1);
        assert.deepEqual(Buffer.from(sent[0]), frame(message));
      });

      it(`receives a complete message containing ${text}`, () => {
        const { parser, received } = setup();
        parser.handleData(frame(protocol.message(text)));
        assert.deepEqual(received, [protocol.expected(text)]);
      });
    }

    it('waits for a complete header and body, including split UTF-8 characters', () => {
      const { parser, received } = setup();
      const text = 'café — 日本語 😀';
      const data = frame(protocol.message(text));
      // One-byte chunks split the header and every multibyte character.
      for (let i = 0; i < data.length - 1; i++) {
        parser.handleData(data.subarray(i, i + 1));
        assert.deepEqual(received, []);
      }
      parser.handleData(data.subarray(data.length - 1));
      assert.deepEqual(received, [protocol.expected(text)]);
    });

    it('receives consecutive Unicode and ASCII messages in one chunk', () => {
      const { parser, received } = setup();
      const texts = ['日本語 😀', 'next ASCII message', 'café'];
      parser.handleData(Buffer.concat(texts.map((text) => frame(protocol.message(text)))));
      assert.deepEqual(received, texts.map((text) => protocol.expected(text)));
    });

    it('retains an incomplete next message after consuming a Unicode message', () => {
      const { parser, received } = setup();
      const first = '日本語';
      const second = '😀 next';
      const nextFrame = frame(protocol.message(second));
      const split = nextFrame.indexOf(Buffer.from('😀')) + 2;
      parser.handleData(Buffer.concat([
        frame(protocol.message(first)), nextFrame.subarray(0, split),
      ]));
      assert.deepEqual(received, [protocol.expected(first)]);
      parser.handleData(nextFrame.subarray(split));
      assert.deepEqual(received, [protocol.expected(first), protocol.expected(second)]);
    });

    it('enforces the receive limit in bytes across chunks', () => {
      const { client, parser } = setup();
      // Under 10 MiB in UTF-16 code units, but over the byte limit.
      const data = Buffer.from('é'.repeat(3 * 1024 * 1024));
      parser.handleData(data);
      assert.equal(client.shouldReconnect(), true);
      parser.handleData(data);
      assert.equal(client.shouldReconnect(), false);
    });
  });
}
