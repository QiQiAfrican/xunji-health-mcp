import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getTraining, queryPlan } from "./xunji.js";

const mcp = new McpServer({ name: "xunji-health-mcp", version: "0.2.0" });

mcp.tool(
  "xunji_get_training",
  "Read Xunji training data for one date. full_data=true returns detailed sets, RPE, notes, rests, metrics and heart-rate data.",
  {
    date: z.string().describe("YYYY-MM-DD"),
    full_data: z.boolean().default(false),
  },
  async ({ date, full_data }) => ({
    content: [{ type: "text", text: JSON.stringify(await getTraining(date, full_data)) }],
  })
);

mcp.tool(
  "xunji_query_plan",
  "Query Xunji official training plans.",
  { payload: z.record(z.any()) },
  async ({ payload }) => ({
    content: [{ type: "text", text: JSON.stringify(await queryPlan(payload)) }],
  })
);

// Read-only v0.2: no write-back tool.
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // stateless mode
});
await mcp.connect(transport);

const port = Number(process.env.PORT || 3000);

function sendJson(res, status, obj) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const started = Date.now();

  res.on("finish", () => {
    console.log(`${req.method} ${url.pathname} -> ${res.statusCode} ${Date.now() - started}ms`);
  });

  if (url.pathname === "/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "xunji-health-mcp",
      version: "0.2.0",
    });
  }

  if (url.pathname === "/mcp") {
    try {
      // The SDK's Streamable HTTP transport needs the already-parsed JSON-RPC
      // body when using Node's native http server.
      const parsedBody =
        req.method === "POST" ? await readJsonBody(req) : undefined;

      return await transport.handleRequest(req, res, parsedBody);
    } catch (e) {
      console.error("MCP request failed:", e);
      if (!res.headersSent) {
        return sendJson(res, 500, {
          error: String(e?.message || e),
        });
      }
      res.end();
      return;
    }
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
}).listen(port, "0.0.0.0", () => {
  console.log(`Xunji MCP v0.2 listening on ${port}`);
});
