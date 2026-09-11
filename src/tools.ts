import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListResourcesRequestSchema, ListPromptsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { apiGet, apiPost, SITE, DEFAULT_LANG } from "./api.js";

const SITE_URL = "https://transparent.pt";
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const eur = (n?: number) => (typeof n === "number" ? `€${Math.round(n).toLocaleString("en-US")}` : "—");
const carUrl = (slug: string) => `${SITE_URL}/${DEFAULT_LANG}/car/${slug}`;

export function registerTools(server: McpServer) {
  // ---- search_inventory ---------------------------------------------------
  server.tool(
    "search_inventory",
    "Search TransparentCars' current stock of budget used cars in Portugal — honestly listed, everyday cars for the local market. Filter by make, model, fuel, gearbox and max price. Returns matching cars with price, year, mileage and a link. IMPORTANT — pass make/model canonically in Latin, as the Portuguese market lists them: make = full brand name ('BMW', 'Mercedes-Benz' not 'Mercedes', 'Volkswagen' not 'VW'); model = the short series/model WITHOUT the engine or trim suffix ('Golf' not 'Golf 1.5 TSI', 'Clio' not 'Clio dCi'). Put the fuel in the fuel field, not the model. If unsure of the spelling, call list_makes_models first.",
    {
      make: z.string().optional().describe("Full brand name in Latin, as the market lists it — 'Renault', 'Volkswagen' (not 'VW'), 'Peugeot', 'Seat'."),
      model: z.string().optional().describe("Short model name WITHOUT engine or trim — 'Clio' (not 'Clio 1.5 dCi'), 'Golf' (not 'Golf TSI')."),
      fuel: z.string().optional().describe("Fuel: petrol, diesel, hybrid, phev, electric, lpg"),
      gearbox: z.string().optional().describe("Gearbox: manual or automatic"),
      max_price: z.number().optional().describe("Maximum price in EUR"),
      min_year: z.number().optional().describe("Earliest registration year"),
      limit: z.number().int().min(1).max(50).optional().describe("Max results (default 20)"),
    },
    async (a) => {
      const params: Record<string, string | number | undefined> = { site: SITE, lang: DEFAULT_LANG };
      if (a.make) params.make = a.make;
      if (a.fuel) params.fuel = a.fuel;
      if (a.gearbox) params.gearbox = a.gearbox;
      if (typeof a.max_price === "number") params.max_price = a.max_price;
      const data = await apiGet("/cars", params);
      let cars: any[] = data?.cars || [];
      const norm = (s: unknown) => String(s || "").toLowerCase();
      // Client-side narrowing for filters the API doesn't take (model, min_year) and as a safety net.
      if (a.make) cars = cars.filter((c) => norm(c.make).includes(norm(a.make)));
      if (a.model) cars = cars.filter((c) => norm(c.model).includes(norm(a.model)));
      if (a.fuel) cars = cars.filter((c) => norm(c.fuel).includes(norm(a.fuel)) || norm(c.fuel_code).includes(norm(a.fuel)));
      if (a.gearbox) cars = cars.filter((c) => norm(c.gearbox).includes(norm(a.gearbox)));
      if (typeof a.max_price === "number") cars = cars.filter((c) => (c.price_eur ?? Infinity) <= a.max_price!);
      if (typeof a.min_year === "number") cars = cars.filter((c) => (c.year ?? 0) >= a.min_year!);
      cars = cars.slice(0, a.limit ?? 20);
      if (!cars.length)
        return text("No cars in stock match those filters right now. Try widening the search, or browse everything at " + `${SITE_URL}/${DEFAULT_LANG}/cars`);
      const lines = cars.map(
        (c) => `• ${c.make} ${c.model} (${c.year || "—"}) — ${eur(c.price_eur)}, ${(c.km ?? 0).toLocaleString("en-US")} km, ${c.fuel || "—"}${c.gearbox ? ", " + c.gearbox : ""}\n  ${carUrl(c.slug)}`
      );
      return text(`${cars.length} car(s) in stock:\n\n${lines.join("\n")}`);
    }
  );

  // ---- get_car ------------------------------------------------------------
  server.tool(
    "get_car",
    "Get full details for one car in TransparentCars stock by its slug (from a search_inventory link, e.g. 'renault-clio-2016').",
    { slug: z.string().describe("Car slug from a search_inventory result URL") },
    async (a) => {
      const c = await apiGet(`/cars/${encodeURIComponent(a.slug)}`, { site: SITE, lang: DEFAULT_LANG });
      const specs = [
        `Price: ${eur(c.price_eur)}`,
        `Year: ${c.year || "—"}`,
        `Mileage: ${(c.km ?? 0).toLocaleString("en-US")} km`,
        `Fuel: ${c.fuel || "—"}`,
        `Gearbox: ${c.gearbox || "—"}`,
        `Body: ${c.body || "—"}`,
        c.hp ? `Power: ${c.hp} hp` : null,
        c.cc ? `Engine: ${c.cc} cc` : null,
        c.co2 ? `CO₂: ${c.co2} g/km` : null,
        c.colour ? `Colour: ${c.colour}` : null,
      ].filter(Boolean).join("\n");
      const desc = c.description ? `\n\n${c.description}` : "";
      return text(`${c.make} ${c.model} (${c.year || "—"})\n${specs}${desc}\n\n${carUrl(c.slug)}`);
    }
  );

  // ---- check_fair_price ---------------------------------------------------
  server.tool(
    "check_fair_price",
    "Check whether a car's asking price is fair for the Portuguese market — the TransparentCars transparency check. Given make, model, year and mileage, it returns the range comparable cars actually sell for (low / typical / high), built from real listings. If you pass asking_price, it also gives a plain verdict: fair, above market, or below market — so a buyer knows before they walk in. Works for ANY car (a listing you found elsewhere, or one of ours). IMPORTANT — pass make/model canonically in Latin: make = full brand name ('Renault', 'Volkswagen' not 'VW'); model = short name WITHOUT engine/trim ('Clio' not 'Clio dCi', 'Golf' not 'Golf 1.5 TSI'). If unsure of spelling, call list_makes_models first.",
    {
      make: z.string().describe("Full brand name in Latin — 'Renault', 'Volkswagen' (not 'VW'), 'Peugeot', 'Seat'."),
      model: z.string().describe("Short model name WITHOUT engine or trim — 'Clio' (not 'Clio 1.5 dCi'), 'Golf' (not 'Golf TSI')."),
      year: z.number().int().describe("Registration year"),
      km: z.number().int().describe("Mileage in km"),
      fuel: z.string().optional().describe("Fuel: petrol, diesel, hybrid, electric"),
      gearbox: z.string().optional().describe("Gearbox: manual or automatic"),
      hp: z.number().int().optional().describe("Power in hp (sharpens the comparison)"),
      asking_price: z.number().optional().describe("The price being asked for THIS car, in EUR — pass it to get a fair / above-market / below-market verdict."),
    },
    async (a) => {
      const v = await apiGet("/valuation", {
        make: a.make, model: a.model, year: a.year, km: a.km,
        fuel: a.fuel, gearbox: a.gearbox, hp: a.hp,
      });
      const carLbl = `${a.make} ${a.model} ${a.year}, ${a.km.toLocaleString("en-US")} km`;
      if (!v?.found)
        return text(
          `Not enough comparable listings to price that ${a.make} ${a.model} automatically right now. ` +
          `Try again without the fuel/gearbox filters, or ask us to look manually via contact_me.`
        );
      const rough = v.rough ? " (rough — few comparables)" : "";
      const lines = [
        `Fair-price check for ${carLbl}${rough}:`,
        `• Typical (market): ${eur(v.median)}`,
        `• Fair range: ${eur(v.low)} – ${eur(v.high)}`,
        v.days_sell ? `• Avg. time to sell: ~${v.days_sell} days` : null,
        `Based on ${v.comps} comparable listing(s) — the range similar cars actually go for.`,
      ].filter(Boolean);

      if (typeof a.asking_price === "number") {
        const ask = a.asking_price;
        let verdict: string;
        if (ask <= v.low) {
          const under = Math.round(((v.median - ask) / v.median) * 100);
          verdict = `Asking ${eur(ask)} → BELOW MARKET. That's under the fair range${under > 0 ? ` (~${under}% below typical)` : ""}. Good on price — check why it's cheap (condition, history, mileage), but the number itself is buyer-friendly.`;
        } else if (ask >= v.high) {
          const over = Math.round(((ask - v.median) / v.median) * 100);
          verdict = `Asking ${eur(ask)} → ABOVE MARKET. That's over the fair range${over > 0 ? ` (~${over}% above typical)` : ""}. There's room to negotiate down, or the seller should justify the premium (low km, full history, extras).`;
        } else {
          verdict = `Asking ${eur(ask)} → FAIR. It sits inside the range comparable cars sell for. A reasonable ask — small negotiation room as always.`;
        }
        lines.push("", verdict);
      } else {
        lines.push("", "Pass asking_price to get a fair / above-market / below-market verdict on a specific listing.");
      }
      return text(lines.join("\n"));
    }
  );

  // ---- cost_to_own --------------------------------------------------------
  server.tool(
    "cost_to_own",
    "Estimate a car's yearly running-cost floor in Portugal — the annual IUC road tax (Imposto Único de Circulação) every owner pays, plus a plain running-cost framing. Needs engine displacement (cc), CO₂ (g/km), fuel and first-registration year. Use this to help a buyer budget the true cost of keeping a car, beyond the sticker price.",
    {
      cc: z.number().int().describe("Engine displacement in cm³, e.g. 1200"),
      co2: z.number().describe("CO₂ emissions in g/km, e.g. 120"),
      fuel: z.string().describe("Fuel: petrol, diesel, hybrid, phev, electric, lpg"),
      year: z.number().int().describe("First registration year, e.g. 2016"),
      month: z.number().int().min(1).max(12).optional().describe("First-registration month (1-12), refines the CO₂ regime"),
      used: z.boolean().optional().describe("Used vehicle (true, default)"),
    },
    async (a) => {
      const r = await apiGet("/isv", {
        cc: a.cc, co2: a.co2, fuel: a.fuel, year: a.year,
        month: a.month, used: a.used === false ? 0 : 1,
      });
      const iuc = r?.iuc;
      if (!iuc || typeof iuc.iuc !== "number")
        return text(`Couldn't work out the road tax for those inputs. Double-check cc, CO₂ and year.`);
      if (iuc.exempt)
        return text(`Annual road tax (IUC): €0/year — exempt.${iuc.note ? " " + iuc.note : ""}\n\nSo the yearly tax floor on this car is nothing; you'd still budget insurance, inspection (IPO) and servicing.`);
      const annual = iuc.iuc;
      const parts = [
        `Annual road tax (IUC): ${eur(annual)}/year`,
        typeof iuc.taxa_cilindrada === "number" ? `  engine component: ${eur(iuc.taxa_cilindrada)}` : null,
        typeof iuc.taxa_co2 === "number" && iuc.taxa_co2 ? `  CO₂ component: ${eur(iuc.taxa_co2)}` : null,
        typeof iuc.diesel_adic === "number" && iuc.diesel_adic ? `  diesel component: ${eur(iuc.diesel_adic)}` : null,
      ].filter(Boolean);
      const framing =
        `\n\nThat IUC is the guaranteed yearly cost just to keep it road-legal (~${eur(Math.round(annual / 12))}/month). ` +
        `On top of it, budget insurance, the annual IPO inspection and routine servicing — the real cost of owning the car, not just buying it.` +
        `${iuc.note ? "\n" + iuc.note : ""}\n\nEstimate from the official IUC table; confirm the exact figure with Finanças.`;
      return text(parts.join("\n") + framing);
    }
  );

  // ---- list_makes_models -------------------------------------------------
  server.tool(
    "list_makes_models",
    "List the exact canonical car makes (brands) TransparentCars can search and price — or, given a make, that brand's models — using the exact strings the other tools expect. Call this FIRST (or whenever unsure of spelling) and pass the returned values verbatim into search_inventory / check_fair_price. No make = the list of brands; with a make = that brand's models.",
    { make: z.string().optional().describe("Brand to list models for, e.g. 'Renault'. Omit to get the list of brands.") },
    async (a) => {
      const r = await apiGet("/car_refs", a.make ? { make: a.make } : {});
      if (!a.make) {
        const makes = r?.makes || [];
        return text(makes.length ? `Available makes (pass one of these EXACTLY as 'make'):\n${makes.join(", ")}` : "Couldn't load the make list right now.");
      }
      const models = r?.models || [];
      return text(models.length
        ? `Models for ${r.make} (pass one of these EXACTLY as 'model'):\n${models.join(", ")}`
        : `No models found for '${a.make}'. Check the make spelling by calling list_makes_models with no argument.`);
    }
  );

  // ---- contact_me ---------------------------------------------------------
  server.tool(
    "contact_me",
    "Send a contact request to TransparentCars so a human gets in touch. Only call this when the user explicitly asks to be contacted, provides their own name and a phone or email, AND agrees to share those details — pass consent=true only then. Submitting shares the provided contact details per the TransparentCars privacy policy.",
    {
      name: z.string().describe("The person's name (as they gave it)"),
      contact: z.string().describe("A phone number or email where they can be reached"),
      message: z.string().optional().describe("What they want / their question"),
      consent: z.boolean().describe("Set true ONLY if the user explicitly agreed to share their contact details and be contacted"),
    },
    async (a) => {
      if (!a.consent) return text("Before sending, the user must explicitly agree to share their contact details with TransparentCars. Confirm consent, then call again with consent=true.");
      if (!a.contact || !a.contact.trim()) return text("A phone number or email is required to send a contact request. Ask the user for one.");
      const val = a.contact.trim();
      const isEmail = val.includes("@");
      const r = await apiPost("/lead", {
        kind: "contact",
        name: a.name,
        email: isEmail ? val : undefined,
        phone: isEmail ? undefined : val,
        message: a.message,
        lang: DEFAULT_LANG,
        source: "mcp",
        consent: true,
      });
      if (r?.duplicate) return text("You already sent this request — TransparentCars has it and will be in touch.");
      return text("Sent ✓ TransparentCars received your request and will contact you soon.");
    }
  );

  // This is a tools-only server. Advertise empty resources/prompts (rather than leaving them
  // unregistered) so probing clients — Smithery's inspector, etc. — get an empty list back
  // instead of a "-32601 Method not found" warning. Must register the capability before the handler.
  const low = server.server as any;
  low.registerCapabilities({ resources: {}, prompts: {} });
  low.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
  low.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
}
