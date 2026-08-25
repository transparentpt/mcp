import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "smoke", version: "1.0" });
await client.connect(transport);

const tools = await client.listTools();
const names = tools.tools.map((t) => t.name);
console.log("TOOLS:", names.join(", "));

const expected = ["search_inventory", "get_car", "check_fair_price", "cost_to_own", "list_makes_models", "contact_me"];
const missing = expected.filter((n) => !names.includes(n));
if (missing.length) throw new Error("MISSING TOOLS: " + missing.join(", "));
if (names.length !== expected.length) throw new Error(`Expected exactly ${expected.length} tools, got ${names.length}: ${names.join(", ")}`);

// No Clara / ISV / import surface must leak into the tool list.
const banned = names.filter((n) => /isv|import|clara|resale|credit/i.test(n));
if (banned.length) throw new Error("BANNED TOOL NAMES PRESENT: " + banned.join(", "));

await client.close();
console.log("\nSMOKE OK — 6 tools, no ISV/import/Clara surface");
