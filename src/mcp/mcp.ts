#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createContext } from '../core/index';
import { createMcpServer } from './index';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { 'data-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) {
    process.stdout.write(
      'Usage: contextdock-mcp [--data-dir <directory>]\nLocal MCP server over stdin/stdout. Configure this command in your MCP client.\n',
    );
    return;
  }
  const context = createContext({ dataDir: values['data-dir'] });
  const server = createMcpServer(context.service);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    try {
      await server.close();
    } finally {
      context.close();
    }
  };
  const closeSafely = () => {
    void close().catch(reportError);
  };
  server.server.onclose = () => {
    context.close();
  };
  process.once('exit', () => {
    context.close();
  });
  process.once('SIGINT', closeSafely);
  process.once('SIGTERM', closeSafely);
  process.stdin.once('end', closeSafely);
  try {
    await server.connect(new StdioServerTransport());
  } catch (error) {
    await close();
    throw error;
  }
}

function reportError(error: unknown): void {
  process.stderr.write(
    `ContextDock MCP: ${error instanceof Error ? error.message : 'An unexpected error occurred.'}\n`,
  );
  process.exitCode = 1;
}

void main().catch(reportError);
