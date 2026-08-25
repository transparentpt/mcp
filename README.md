<p align="center">
  <img src="./assets/wordmark.png" alt="TransparentCars" width="320" />
</p>

# TransparentCars MCP server

[![MCP](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

An [MCP](https://modelcontextprotocol.io) server that lets AI assistants work with **[TransparentCars](https://transparent.pt)** — honest, budget used cars for the local Portuguese market. Search live stock, check whether a car's asking price is actually fair, estimate the yearly cost of keeping a car on the road, and get in touch.

It's a thin, open-source wrapper over the public `transparent.pt` API — no keys, no setup beyond adding the server.

## Tools

| Tool | What it does |
|------|--------------|
| `search_inventory` | Search current budget stock by make, model, fuel, gearbox, price, year |
| `get_car` | Full details + specs for one car |
| `check_fair_price` | The market range a car sells for — plus a fair / above-market / below-market verdict on an asking price |
| `cost_to_own` | The annual IUC road tax + a plain running-cost framing for budgeting |
| `list_makes_models` | Canonical brand/model names the other tools expect |
| `contact_me` | Ask a human to get in touch (needs the user's consent + contact) |

The **fair-price check** is the point: paste any listing's price and get a straight answer on whether it's a good deal — no sales spin.

## Use it

### Remote (add a URL)

```
https://transparent.pt/mcp
```

Add it in any client that supports remote/Streamable HTTP MCP servers.

### Local (stdio, via npx)

Claude Desktop / Cline / Continue config:

```json
{
  "mcpServers": {
    "transparentcars": {
      "command": "npx",
      "args": ["-y", "transparentcars-mcp"]
    }
  }
}
```

## Examples

- "Find a manual petrol car under €10,000 in TransparentCars stock."
- "A dealer wants €9,500 for a 2014 Renault Clio with 120,000 km — is that fair?"
- "What's the yearly road tax on a 2016 petrol, 1200 cc, 120 g/km CO₂?"
- "Ask TransparentCars to call me — my name is … and my number is …"

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `TC_API_BASE` | `https://transparent.pt/api/public` | Public API base |
| `TC_SITE` | `transparentcars` | Site key the API is scoped to |
| `TC_LANG` | `en` | Response language (pt/en) |
| `PORT` / `MCP_PATH` | `8099` / `/mcp` | HTTP server (remote mode) |

## Develop

```bash
npm install
npm run build
node dist/index.js        # stdio
npm run start:http        # remote HTTP on :8099/mcp
```

## Notes

- **Estimates, not guarantees.** The fair-price range and running-cost figures are estimates built from real comparable listings and the official road-tax table; treat them as guidance, not a formal valuation.
- **Privacy.** `contact_me` sends the details the user provides to TransparentCars ([privacy policy](https://transparent.pt/en/privacy)); it requires explicit user intent and consent.
- No business logic or data lives in this repo — it only calls the public API.

MIT © TransparentCars
