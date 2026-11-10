#!/usr/bin/env node
// TransparentCars MCP server — stdio transport (for `npx transparentcars-mcp`, Claude Desktop, Cline, etc.)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

const server = new McpServer({ name: "transparentcars", version: "0.3.0" });
registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr only — stdout is the MCP channel
console.error("transparentcars-mcp running on stdio");
