# Xunji Health MCP
Read-only MCP bridge between Xunji training data and ChatGPT Health.

## Tools
- `xunji_get_training(date, full_data)`
- `xunji_query_plan(payload)`

## Endpoints
- `/health`
- `/mcp`

Deploy with Docker/Render. Configure `XUNJI_API_KEY` only as a Render environment secret. Never commit credentials or personal health data.

v0.1 intentionally excludes Xunji write-back.
