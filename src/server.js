import { fileURLToPath } from 'node:url';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createXunjiMcpServer } from './mcp.js';

const VERSION = '0.3.1';
const DEFAULT_PORT = 10_000;
const DEFAULT_PUBLIC_HOST = 'xunji-health-mcp.onrender.com';

function getAllowedHosts() {
  const configured = process.env.MCP_ALLOWED_HOSTS
    ?.split(',')
    .map((host) => host.trim())
    .filter(Boolean) || [];
  const renderHost = process.env.RENDER_EXTERNAL_HOSTNAME?.trim();
  return [...new Set([
    '127.0.0.1',
    'localhost',
    '[::1]',
    DEFAULT_PUBLIC_HOST,
    ...(renderHost ? [renderHost] : []),
    ...configured
  ])];
}

function rpcMetadata(body) {
  const messages = Array.isArray(body) ? body : [body];
  const methods = messages
    .map((message) => typeof message?.method === 'string' ? message.method : null)
    .filter(Boolean)
    .slice(0, 8);
  return {
    rpcMethods: methods.length ? methods.join(',') : 'none',
    batchSize: messages.length
  };
}

function safeErrorMetadata(error, phase) {
  return {
    event: 'mcp_error',
    phase,
    errorType: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
    errorCode: ['string', 'number'].includes(typeof error?.code) ? String(error.code).slice(0, 80) : 'none'
  };
}

function jsonRpcError(res, status, code, message) {
  if (res.headersSent) return;
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null
  });
}

export function createApp() {
  // Render binds the process to all interfaces. Keep DNS-rebinding protection
  // enabled by explicitly allowing the public service host plus local test hosts.
  const app = createMcpExpressApp({
    host: '0.0.0.0',
    allowedHosts: getAllowedHosts()
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'xunji-health-mcp', version: VERSION });
  });

  app.post('/mcp', async (req, res) => {
    const startedAt = performance.now();
    const rpc = rpcMetadata(req.body);
    let server;
    let transport;
    let cleanedUp = false;

    const cleanup = async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      await Promise.allSettled([
        transport?.close(),
        server?.close()
      ]);
    };

    const logCompletion = () => {
      console.info(JSON.stringify({
        event: 'http_request',
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
        ...rpc
      }));
    };

    res.once('finish', logCompletion);
    res.once('close', () => {
      if (!res.writableFinished) {
        console.warn(JSON.stringify({
          event: 'mcp_connection_closed',
          phase: 'response',
          ...rpc
        }));
      }
      void cleanup();
    });

    try {
      // Stateless mode requires a fresh server and transport for every POST.
      // Reusing either instance can mix client state and request IDs.
      server = createXunjiMcpServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(JSON.stringify(safeErrorMetadata(error, transport ? 'handle_request' : 'setup')));
      jsonRpcError(res, 500, -32603, 'Internal server error');
      await cleanup();
    }
  });

  const rejectUnsupportedMcpMethod = (req, res) => {
    console.info(JSON.stringify({
      event: 'http_request',
      method: req.method,
      path: req.path,
      status: 405,
      durationMs: 0,
      rpcMethods: 'none',
      batchSize: 0
    }));
    res.set('Allow', 'POST');
    jsonRpcError(res, 405, -32000, 'Method not allowed. Use POST for stateless MCP requests.');
  };

  app.get('/mcp', rejectUnsupportedMcpMethod);
  app.delete('/mcp', rejectUnsupportedMcpMethod);

  // Express JSON-parser failures occur before the MCP route. Report only
  // non-sensitive metadata; never include the parser message or body.
  app.use((error, req, res, next) => {
    if (!error) return next();
    const status = error?.type === 'entity.too.large' ? 413 : 400;
    console.error(JSON.stringify({
      event: 'mcp_error',
      phase: 'parse_request',
      errorType: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
      errorCode: typeof error?.type === 'string' ? error.type.slice(0, 80) : 'none',
      method: req.method,
      path: req.path,
      status
    }));
    jsonRpcError(
      res,
      status,
      status === 413 ? -32000 : -32700,
      status === 413 ? 'Request body too large' : 'Parse error'
    );
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  return app;
}

export function startServer(port = Number.parseInt(process.env.PORT || '', 10) || DEFAULT_PORT) {
  const app = createApp();
  const httpServer = app.listen(port, '0.0.0.0', () => {
    const address = httpServer.address();
    const activePort = typeof address === 'object' && address ? address.port : port;
    console.info(`Xunji MCP v${VERSION} listening on ${activePort}`);
  });

  const shutdown = (signal) => {
    console.info(`Received ${signal}; shutting down`);
    httpServer.close((error) => process.exit(error ? 1 : 0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return httpServer;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) startServer();
