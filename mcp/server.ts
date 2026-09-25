import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ApiClient, readApiConfigFromEnv } from './api-client.js'
import { buildMcpServer } from './tools.js'

// MCP server entrypoint (spec art_HKWx4t5y §5) — stdio transport for local
// agents. A thin client of API v1: credentials and the API origin come from
// env, and every tool call is one authenticated HTTP request. Run with:
//   VIDEO_RAG_API_URL=https://api.example.com VIDEO_RAG_API_KEY=vidrag_sk_… bun mcp/server.ts
//
// Startup misconfiguration goes to stderr (never stdout — that stream is the
// stdio transport) and never echoes the key value. Nothing here is imported
// by tests: they drive buildMcpServer directly (mcp/tools.ts).

function loadClientFromEnv(): ApiClient {
  try {
    return new ApiClient(readApiConfigFromEnv())
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

async function main(): Promise<void> {
  const server = buildMcpServer(loadClientFromEnv())
  await server.connect(new StdioServerTransport())
  // Stdio transport keeps the process alive reading framed messages.
}

await main()
