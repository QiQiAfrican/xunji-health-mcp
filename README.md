# Xunji Health MCP v0.3.2

A small, read-only MCP server for retrieving training data from the Xunji Open API.

## What changed in v0.3.2

- Uses the official `@modelcontextprotocol/sdk` stateless Streamable HTTP pattern.
- Creates a fresh `McpServer` and `StreamableHTTPServerTransport` for every `POST /mcp`.
- Connects the server before handling the request and closes both instances after the response.
- Handles `initialize`, `notifications/initialized`, and `tools/list` without sharing transport state between requests.
- Logs only request metadata (method, path, status, duration, JSON-RPC method) and safe error type/code.
- Never logs request bodies, tool arguments, Xunji responses, API keys, or health data.
- Allows the Render public hostname while retaining DNS-rebinding protection.
- Accepts successful Xunji responses based on HTTP status plus the documented `res` field; `success: true` is not required.
- Connects `xunji_query_plan` to the official gzip plan endpoint with `list` and `get` actions.

## Tools

- `xunji_get_training`: read one date of training records.
- `xunji_query_plan`: list official plans or read one plan over an optional range of up to 92 days.

Both tools are annotated as read-only and call only Xunji's read endpoint. There is no write-back tool or write endpoint in this project.

## Environment variables

Set these in Render, not in source control:

| Name | Required | Default |
| --- | --- | --- |
| `XUNJI_API_KEY` | Yes | none |
| `PORT` | No | `10000` |
| `XUNJI_API_BASE` | No | `https://trains.xunjiapp.cn` |
| `XUNJI_PLAN_API_BASE` | No | `https://api.xunjiapp.cn` |
| `XUNJI_REQUEST_TIMEOUT_MS` | No | `20000` |
| `MCP_ALLOWED_HOSTS` | No | Render hostname plus local test hosts |

Never commit a real API key. `.env*` files are ignored except for the empty `.env.example` template.

## Local test

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm start
```

Then check:

```text
GET http://localhost:10000/health
POST http://localhost:10000/mcp
```

## Render

The included Dockerfile listens on Render's `PORT`. Keep the existing `XUNJI_API_KEY` environment variable and deploy the repository root.

The ChatGPT MCP URL remains:

```text
https://xunji-health-mcp.onrender.com/mcp
```

After deployment, `/health` should return version `0.3.2`.
