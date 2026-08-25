import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "live", version: "1.0" });
await client.connect(transport);

let failures = 0;
async function call(name, args, assertFn) {
  const r = await client.callTool({ name, arguments: args });
  const out = r.content.map((c) => c.text).join("\n");
  console.log(`\n--- ${name}(${JSON.stringify(args)}) ---`);
  console.log(out.slice(0, 600));
  try {
    assertFn(out);
    console.log("  ✓ assertion passed");
  } catch (e) {
    failures++;
    console.log("  ✗ ASSERTION FAILED: " + e.message);
  }
}

const must = (out, re, label) => { if (!re.test(out)) throw new Error(`${label} — got: ${out.slice(0, 200)}`); };

// list_makes_models — brands, then models
await call("list_makes_models", {}, (o) => must(o, /Renault/i, "expected Renault in brand list"));
await call("list_makes_models", { make: "Renault" }, (o) => must(o, /Clio/i, "expected Clio in Renault models"));

// check_fair_price — no asking price
await call("check_fair_price", { make: "Renault", model: "Clio", year: 2014, km: 120000, fuel: "petrol", gearbox: "manual" },
  (o) => must(o, /Fair range:\s*€[\d,]+\s*–\s*€[\d,]+/, "expected a fair range"));

// check_fair_price — with asking price BELOW market
await call("check_fair_price", { make: "Renault", model: "Clio", year: 2014, km: 120000, asking_price: 4000 },
  (o) => must(o, /BELOW MARKET/, "expected BELOW MARKET verdict at €4000"));

// check_fair_price — with asking price ABOVE market
await call("check_fair_price", { make: "Renault", model: "Clio", year: 2014, km: 120000, asking_price: 20000 },
  (o) => must(o, /ABOVE MARKET/, "expected ABOVE MARKET verdict at €20000"));

// cost_to_own — IUC road tax
await call("cost_to_own", { cc: 1200, co2: 120, fuel: "petrol", year: 2016 },
  (o) => { must(o, /Annual road tax \(IUC\):\s*€[\d,]+\/year/, "expected annual IUC"); must(o, /^(?!.*ISV)[\s\S]*$/, "ISV must not appear"); });

// search_inventory — must not error (stock may be empty)
await call("search_inventory", { max_price: 15000 },
  (o) => must(o, /(car\(s\) in stock|No cars in stock)/, "expected a stock response"));

// contact_me — consent gate WITHOUT posting a real lead (consent=false path, no network write)
await call("contact_me", { name: "Test", contact: "test@example.com", consent: false },
  (o) => must(o, /must explicitly agree/i, "expected consent gate"));

await client.close();
console.log(failures ? `\nLIVE TEST: ${failures} FAILURE(S)` : "\nLIVE TEST OK — all assertions passed");
if (failures) process.exit(1);
