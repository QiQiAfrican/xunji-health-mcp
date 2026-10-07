import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/server.js';

let httpServer;
let baseUrl;

before(async () => {
  httpServer = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    httpServer.once('listening', resolve);
    httpServer.once('error', reject);
  });
  const { port } = httpServer.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    httpServer.close((error) => error ? reject(error) : resolve());
  });
});

test('health endpoint reports v0.3.0', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'xunji-health-mcp',
    version: '0.3.0'
  });
});

test('SDK client completes initialize and tools/list', async () => {
  const client = new Client({ name: 'xunji-test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  try {
    await client.connect(transport);
    const result = await client.listTools();
    assert.deepEqual(
      result.tools.map((tool) => tool.name).sort(),
      ['xunji_get_training', 'xunji_query_plan']
    );
    assert.ok(result.tools.every((tool) => tool.annotations?.readOnlyHint === true));
  } finally {
    await client.close();
  }
});

test('concurrent clients have isolated stateless transports', async () => {
  const runClient = async (suffix) => {
    const client = new Client({ name: `concurrent-client-${suffix}`, version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    try {
      await client.connect(transport);
      return (await client.listTools()).tools.map((tool) => tool.name).sort();
    } finally {
      await client.close();
    }
  };

  const results = await Promise.all(Array.from({ length: 4 }, (_, index) => runClient(index)));
  for (const names of results) {
    assert.deepEqual(names, ['xunji_get_training', 'xunji_query_plan']);
  }
});

test('GET and DELETE /mcp are rejected in stateless mode', async () => {
  for (const method of ['GET', 'DELETE']) {
    const response = await fetch(`${baseUrl}/mcp`, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
  }
});

test('malformed JSON returns a safe JSON-RPC parse error', async () => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{'
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    jsonrpc: '2.0',
    error: { code: -32700, message: 'Parse error' },
    id: null
  });
});

test('tool errors do not expose secrets', async () => {
  const originalKey = process.env.XUNJI_API_KEY;
  delete process.env.XUNJI_API_KEY;
  const client = new Client({ name: 'xunji-test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: 'xunji_get_training',
      arguments: { date: '2026-10-07' }
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /XUNJI_NOT_CONFIGURED/);
  } finally {
    await client.close();
    if (originalKey === undefined) delete process.env.XUNJI_API_KEY;
    else process.env.XUNJI_API_KEY = originalKey;
  }
});
