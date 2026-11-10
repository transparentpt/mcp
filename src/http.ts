// TransparentCars MCP server — remote Streamable HTTP transport (for "add a URL" clients).
// Stateless: a fresh server+transport per request (simple, horizontally scalable).
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools.js";

const PORT = Number(process.env.PORT || 8099);
const HOST = process.env.MCP_HOST || "127.0.0.1"; // bind loopback; front with an (auth) proxy, never all-interfaces
const MCP_PATH = process.env.MCP_PATH || "/mcp";

// Anti-DNS-rebinding: this SDK's StreamableHTTPServerTransport doesn't expose allowedHosts, so gate here.
const ALLOWED_HOSTS = (process.env.MCP_ALLOWED_HOSTS || "transparent.pt,mcp.transparent.pt,localhost:8099,127.0.0.1:8099")
  .split(",").map((s) => s.trim().toLowerCase());
const ALLOWED_ORIGINS = (process.env.MCP_ALLOWED_ORIGINS || "https://transparent.pt")
  .split(",").map((s) => s.trim());

function originAllowed(req: IncomingMessage): boolean {
  const host = String(req.headers.host || "").toLowerCase();
  if (!ALLOWED_HOSTS.includes(host)) return false;           // blocks rebinding to attacker Host
  const origin = req.headers.origin;                          // native MCP clients send none → allowed
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return false; // blocks browser cross-origin
  return true;
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  const server = new McpServer({ name: "transparentcars", version: "0.2.0" });
  registerTools(server);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, await readBody(req));
}

createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (url.pathname === MCP_PATH) {
    if (!originAllowed(req)) {
      res.writeHead(403, { "content-type": "text/plain" }).end("forbidden");
      return;
    }
    handleMcp(req, res).catch((e) => {
      console.error("mcp error", e);
      if (!res.headersSent) res.writeHead(500).end();
    });
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, HOST, () => console.error(`transparentcars-mcp HTTP on ${HOST}:${PORT}${MCP_PATH}`));
