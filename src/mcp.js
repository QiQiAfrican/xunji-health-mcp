import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { getTraining, queryPlan, XunjiError } from './xunji.js';

function toolResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value
  };
}

function toolError(error) {
  const known = error instanceof XunjiError;
  const payload = {
    error: known ? error.code : 'INTERNAL_ERROR',
    message: known ? error.message : 'The request could not be completed.'
  };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload
  };
}

export function createXunjiMcpServer() {
  const server = new McpServer(
    { name: 'xunji-health-mcp', version: '0.3.1' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'xunji_get_training',
    {
      title: 'Get Xunji training',
      description: 'Read Xunji training records for one calendar date. This tool is read-only.',
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Calendar date in YYYY-MM-DD format'),
        include_full_data: z.boolean().optional().default(false).describe(
          'Include incomplete sets, RPE, notes, feelings, side-specific weights and detailed metrics'
        )
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (args) => {
      try {
        return toolResult(await getTraining(args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'xunji_query_plan',
    {
      title: 'Query Xunji training plan range',
      description: 'Read Xunji training records across an inclusive date range (maximum 31 days). This tool is read-only.',
      inputSchema: {
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('First date in YYYY-MM-DD format'),
        end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Last date in YYYY-MM-DD format'),
        include_full_data: z.boolean().optional().default(false).describe(
          'Include incomplete sets, RPE, notes, feelings, side-specific weights and detailed metrics'
        )
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (args) => {
      try {
        return toolResult(await queryPlan(args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  return server;
}
