import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListResourcesRequestSchema, ListPromptsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { apiGet, apiPost, SITE, DEFAULT_LANG } from "./api.js";

const SITE_URL = "https://transparent.pt";
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const eur = (n?: number) => (typeof n === "number" ? `€${Math.round(n).toLocaleString("en-US")}` : "—");
const carUrl = (slug: string) => `${SITE_URL}/${DEFAULT_LANG}/car/${slug}`;

// Optional inputs shared by the ISV/IUC tools for goods & heavy vehicles. Goods vehicles
// (vans, trucks) are taxed by GROSS WEIGHT (IUC Cat C/D), not cc+CO2; heavy vehicles pay no ISV.
const VEHICLE_PARAMS = {
  vehicle_type: z.enum(["passenger", "van_10", "commercial_15", "commercial_50", "commercial_100",
    "motorcycle", "autocaravana", "pesados_mercadorias", "pesados_passageiros"]).optional()
    .describe("Category (default passenger). Goods van → van_10/commercial_*; heavy goods >3500kg → pesados_mercadorias; bus → pesados_passageiros; motorhome → autocaravana; motorcycle → motorcycle."),
  peso_bruto: z.number().int().optional()
    .describe("Gross weight (kg). REQUIRED for goods vehicles (van_10/commercial_*/pesados_mercadorias): their IUC is weight-based (Cat C/D)."),
  utilizacao: z.enum(["particular", "publico"]).optional()
    .describe("Goods use: particular (Cat C, default) or publico/rental (Cat D)."),
  axles: z.number().int().optional().describe("Heavy rigid goods ≥12t: axles (2/3/4)."),
  suspension: z.enum(["pneumatica", "outro"]).optional().describe("Heavy goods ≥12t: driven-axle suspension."),
  config: z.enum(["rigido", "articulado"]).optional().describe("Heavy goods ≥12t: rigido or articulado (tractor+trailer)."),
  tractor_axles: z.number().int().optional().describe("Articulated ≥12t: tractor axles (2/3)."),
  trailer_axles: z.number().int().optional().describe("Articulated ≥12t: trailer axles (1/2/3)."),
  regiao_autonoma: z.boolean().optional().describe("Used exclusively in Açores/Madeira → −50% IUC (Cat C/D)."),
};

function vehicleArgs(a: any): Record<string, any> {
  const o: Record<string, any> = {};
  for (const k of ["vehicle_type", "peso_bruto", "utilizacao", "axles", "suspension", "config",
    "tractor_axles", "trailer_axles"]) if (a[k] !== undefined) o[k] = a[k];
  if (a.regiao_autonoma !== undefined) o.regiao_autonoma = a.regiao_autonoma ? 1 : 0;
  return o;
}

const SERVICES = [
  { name: "Cars in stock", desc: "Used cars ready to view in Portugal.", url: `${SITE_URL}/${DEFAULT_LANG}/carros` },
  { name: "Import to order", desc: "Source & import a specific car from German/EU auctions, legalized and delivered.", url: `${SITE_URL}/${DEFAULT_LANG}/import` },
  { name: "Car sourcing", desc: "We find the best option for you in Portugal or abroad.", url: `${SITE_URL}/${DEFAULT_LANG}/sourcing` },
  { name: "Auction buying", desc: "We bid for you at professional auctions (Auto1 etc.).", url: `${SITE_URL}/${DEFAULT_LANG}/auction` },
  { name: "We buy / trade-in your car", desc: "Free valuation, fast fair payout.", url: `${SITE_URL}/${DEFAULT_LANG}/sell` },
  { name: "ISV & IUC calculators", desc: "Free Portuguese car-tax estimates.", url: `${SITE_URL}/${DEFAULT_LANG}/isv` },
  { name: "Car legalisation (car already in Portugal)", desc: "Fixed service fee; ISV and state fees paid separately at real cost.", url: `${SITE_URL}/${DEFAULT_LANG}/legalizacao` },
  { name: "Import cost calculator", desc: "Full cost of bringing a car from Germany to Portugal: car (VAT net/gross), transport, paperwork, service, ISV.", url: `${SITE_URL}/${DEFAULT_LANG}/custo-importacao` },
];

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
    "Send a contact request to TransparentCars so a human gets in touch. Only call this when the user explicitly asks to be contacted, provides their own name and a phone or email, AND agrees to share those details — pass consent=true only then. Never invent, guess, or use placeholder / example / test contact details: pass ONLY the real name and real phone or e-mail the user gave you in this conversation. If you don't have a real phone or e-mail from the user, ask them for it before calling — do not submit fake values. Submitting shares the provided contact details per the TransparentCars privacy policy.",
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
      if (r?.rejected) return text(r.reason || "That contact looks like a placeholder. Ask the user for a real phone number or e-mail and call again — never submit example or test values.");
      if (r?.duplicate) return text("You already sent this request — TransparentCars has it and will be in touch.");
      return text("Sent ✓ TransparentCars received your request and will contact you soon.");
    }
  );

  // ---- calculate_isv ------------------------------------------------------
  server.tool(
    "calculate_isv",
    "Estimate Portuguese car import tax (ISV, Imposto Sobre Veículos) from the official ISV formula (engine-cc + CO₂ components, with age reduction for used cars). A maintained estimate: it matches the AT (Finanças) simulator to the cent on the common WLTP cases, but is not the official figure and may differ on edge cases (NEDC, light-commercial, month rounding) — confirm the final amount on the official AT simulator. Needs engine displacement (cc), CO₂ (g/km, WLTP), fuel and registration year.",
    {
      cc: z.number().int().optional().describe("Engine displacement in cm³, e.g. 1950 (not needed for heavy goods/buses)"),
      co2: z.number().optional().describe("CO₂ emissions in g/km (WLTP), e.g. 130 (passenger/motorhome only)"),
      fuel: z.string().optional().describe("Fuel: petrol, diesel, hybrid, hybrid_diesel (diesel MHEV/HEV), phev, electric (irrelevant for heavy goods/buses)"),
      year: z.number().int().describe("First registration year, e.g. 2016"),
      used: z.boolean().optional().describe("Used vehicle (true, default) or new (false)"),
      from_eu: z.boolean().optional().describe("Registered in an EU member state (true, default). Set FALSE for non-EU imports (Switzerland, UK, USA, Japan…) — non-EU used cars get NO age reduction, so the ISV is the FULL amount (plus customs duty ~10% and VAT 23%, which this tool does not compute)."),
      ...VEHICLE_PARAMS,
    },
    async (a) => {
      const r = await apiGet("/isv", {
        cc: a.cc ?? 0, co2: a.co2 ?? 0, fuel: a.fuel ?? "petrol", year: a.year,
        used: a.used === false ? 0 : 1, from_eu: a.from_eu === false ? 0 : 1, ...vehicleArgs(a),
      });
      const isv = r?.isv || r;
      if (isv?.not_subject) return text(`ISV: not subject — ${isv.note || "heavy vehicle (>3500 kg), outside the ISV scope (Art. 2 CISV)"}.\n\nHeavy goods vehicles and buses pay no ISV. Details: ${SITE_URL}/${DEFAULT_LANG}/isv`);
      if (isv?.exempt) return text(`ISV: €0 (exempt). ${isv.note || ""}\n\nISV estimate. Details: ${SITE_URL}/${DEFAULT_LANG}/isv`);
      const parts = [
        `ISV (estimate): ${eur(isv?.isv)}`,
        isv?.table ? `Table: ${isv.table}` : null,
        typeof isv?.comp_cilindrada === "number" ? `  engine component: ${eur(isv.comp_cilindrada)}` : null,
        typeof isv?.comp_ambiental === "number" ? `  environmental component: ${eur(isv.comp_ambiental)}` : null,
        typeof isv?.diesel_surcharge === "number" && isv.diesel_surcharge ? `  diesel surcharge: ${eur(isv.diesel_surcharge)}` : null,
        a.from_eu === false ? "Non-EU import: NO age reduction — this is the FULL ISV. Customs duty (~10%) and VAT (23%) on price+duty+ISV also apply (not included here)." : null,
        isv?.note ? isv.note : null,
      ].filter(Boolean);
      return text(`${parts.join("\n")}\n\nA maintained estimate from the official cc+CO₂ formula — matches the AT (Finanças) simulator to the cent on the common cases; confirm edge cases on the official simulator. Full breakdown: ${SITE_URL}/${DEFAULT_LANG}/isv`);
    }
  );

  // ---- calculate_import_cost ----------------------------------------------
  server.tool(
    "calculate_import_cost",
    "Full turnkey cost of importing a car from Germany / another EU country (e.g. a mobile.de or AutoScout24 listing) to Portugal through TransparentCars: car price + transport + paperwork (inspection, IMT, plates) + TransparentCars service + ISV, as one total, with the yearly IUC road tax shown apart. Handles net/gross VAT: if the dealer listing shows deductible VAT (two prices, e.g. '€36,958 Net, 19% VAT' / 'MwSt. ausweisbar'), pass vat='gross' — the German VAT is removed and Portuguese IVA 23% applied to the net price. Private sellers / margin-scheme cars: vat='final'. An estimate (final ISV is set by the tax authority from the COC). For the tax alone use calculate_isv.",
    {
      price: z.number().positive().describe("Price on the listing in EUR, e.g. 19500"),
      vat: z.enum(["final", "gross", "net"]).optional().describe("How to read price: final (default; private seller / margin scheme, no VAT line), gross (dealer price incl. deductible seller-country VAT), net (price without VAT)"),
      vat_rate: z.number().optional().describe("Seller-country VAT % for vat=gross (DE 19 default, AT 20, IT 22, ES 21, FR 20, NL 21, BE 21)"),
      cc: z.number().int().optional().describe("Engine displacement in cm³ (0 for electric)"),
      co2: z.number().optional().describe("CO₂ g/km (WLTP)"),
      fuel: z.string().optional().describe("petrol, diesel, hybrid, hybrid_diesel, phev, electric, lpg"),
      year: z.number().int().describe("First registration year, e.g. 2021"),
      month: z.number().int().min(1).max(12).optional().describe("First registration month 1-12"),
      range_km: z.number().int().optional().describe("Electric range in km (plug-in hybrids: >=50 km gives the 75% ISV reduction)"),
      used: z.boolean().optional().describe("Used (true, default) or new (false: up to 6 months / 6,000 km)"),
    },
    async (a) => {
      const r = await apiGet("/import-cost", {
        price: a.price, vat: a.vat ?? "final", vat_rate: a.vat_rate, cc: a.cc ?? 0, co2: a.co2 ?? 0,
        fuel: a.fuel ?? "petrol", year: a.year, month: a.month, range_km: a.range_km,
        used: a.used === false ? 0 : 1,
      });
      const c = r?.car || {};
      const carLine = c.net != null
        ? `Car: ${eur(c.cost)} (net ${eur(c.net)} + Portuguese IVA ${c.pt_iva_pct}%; listing ${eur(c.listing_price)})`
        : `Car: ${eur(c.cost)}`;
      const lines = [
        `Turnkey total with Portuguese plates (estimate): ${eur(r?.total_eur)}`,
        carLine,
        `Transport Germany → Portugal: ${eur(r?.transport_eur)}`,
        `Paperwork (inspection, IMT, registration, plates): ${eur(r?.paperwork_eur)}`,
        `TransparentCars turnkey service: ${eur(r?.service_eur)}`,
        `ISV (vehicle tax): ${eur(r?.isv_eur)}`,
        r?.iuc_per_year_eur != null ? `Then every year: IUC road tax ≈ ${eur(r.iuc_per_year_eur)} (ownership cost, not in the total)` : null,
        ...(Array.isArray(r?.warnings) && r.warnings.length ? ["Warnings: " + r.warnings.join("; ")] : []),
      ].filter(Boolean);
      return text(`${lines.join("\n")}\n\nEstimate: final ISV is set by the tax authority from the COC; VAT treatment is confirmed in the quote. Interactive calculator (paste a mobile.de link): ${SITE_URL}/${DEFAULT_LANG}/custo-importacao — to get a firm quote, use request_import_quote.`);
    }
  );

  // ---- calculate_legalization_cost ----------------------------------------
  server.tool(
    "calculate_legalization_cost",
    "Cost of legalising a car that is ALREADY in Portugal (registered in another EU country, brought in by the owner) through TransparentCars: a fixed service fee + ISV + state fees (inspection, IMT, registration, DUA, plates) + the COC if it is missing, returned as a low/high range. Only the service fee is TransparentCars' price; ISV, state fees and the COC are paid separately at real cost against official receipts. Also returns exactly what the fee includes and what it doesn't. Use this when the user already has the car; for buying and importing a car use calculate_import_cost.",
    {
      cc: z.number().int().optional().describe("Engine displacement in cm³ (0 for electric)"),
      co2: z.number().optional().describe("CO₂ g/km (WLTP)"),
      fuel: z.string().optional().describe("petrol, diesel, hybrid, hybrid_diesel, phev, electric, lpg"),
      year: z.number().int().describe("First registration year, e.g. 2019"),
      month: z.number().int().min(1).max(12).optional().describe("First registration month 1-12"),
      range_km: z.number().int().optional().describe("Electric range in km (plug-in hybrids)"),
      has_coc: z.boolean().optional().describe("Does the car have its COC (certificate of conformity)? Default true; false adds the COC cost range"),
    },
    async (a) => {
      const r = await apiGet("/legalization-cost", {
        cc: a.cc ?? 0, co2: a.co2 ?? 0, fuel: a.fuel ?? "petrol", year: a.year, month: a.month,
        range_km: a.range_km, coc: a.has_coc === false ? 0 : 1,
      });
      const rng = (x: any) => (x ? `${eur(x.low)}–${eur(x.high)}` : "—");
      const lines = [
        `Legalisation total (estimate): ${rng(r?.total_eur)}`,
        `TransparentCars service (fixed price): ${eur(r?.service_eur)}`,
        `ISV (paid to the tax authority, at real cost): ${eur(r?.isv_eur)}`,
        `State fees — inspection, IMT, registration, DUA, plates (at real cost): ≈ ${rng(r?.state_fees_eur)}`,
        r?.coc_eur ? `COC from the manufacturer (missing, at real cost): ${rng(r.coc_eur)}` : null,
        r?.iuc_per_year_eur != null ? `Then every year: IUC road tax ≈ ${eur(r.iuc_per_year_eur)}` : null,
        Array.isArray(r?.included_in_service) ? `Included in the service fee: ${r.included_in_service.join("; ")}.` : null,
        Array.isArray(r?.not_included) ? `Not included (paid separately): ${r.not_included.join("; ")}.` : null,
        ...(Array.isArray(r?.warnings) && r.warnings.length ? ["Warnings: " + r.warnings.join("; ")] : []),
      ].filter(Boolean);
      return text(`${lines.join("\n")}\n\nEstimate: final ISV is set by the tax authority; state fees are paid at the official receipt amount. Service page: ${SITE_URL}/${DEFAULT_LANG}/legalizacao — to get a quote, use request_import_quote or contact_me.`);
    }
  );

  // ---- calculate_iuc ------------------------------------------------------
  server.tool(
    "calculate_iuc",
    "Estimate the Portuguese annual road tax (IUC, Imposto Único de Circulação) for a car — the yearly tax an owner pays — from the official IUC table. A maintained estimate; confirm on the official AT simulator. Needs engine displacement (cc), CO₂ (g/km), fuel and registration year.",
    {
      cc: z.number().int().optional().describe("Engine displacement in cm³, e.g. 1950 (not needed for goods vehicles)"),
      co2: z.number().optional().describe("CO₂ emissions in g/km, e.g. 130 (passenger/motorhome only)"),
      fuel: z.string().optional().describe("Fuel: petrol, diesel, hybrid, hybrid_diesel (diesel MHEV/HEV), phev, electric (irrelevant for heavy goods/buses)"),
      year: z.number().int().describe("First registration year, e.g. 2016"),
      ...VEHICLE_PARAMS,
    },
    async (a) => {
      const r = await apiGet("/isv", { cc: a.cc ?? 0, co2: a.co2 ?? 0, fuel: a.fuel ?? "petrol", year: a.year, ...vehicleArgs(a) });
      const iuc = r?.iuc;
      if (!iuc) return text(`Couldn't compute IUC for those inputs. Try the calculator at ${SITE_URL}/${DEFAULT_LANG}/iuc`);
      if (iuc.not_subject) return text(`IUC: not subject — ${iuc.note || "buses are outside the IUC categories (Art. 2 CIUC)"}.\n\nDetails: ${SITE_URL}/${DEFAULT_LANG}/iuc`);
      if (iuc.need_peso) return text(`IUC needs the gross weight (kg) for this goods vehicle (Category C/D is weight-based). Re-run with peso_bruto. Calculator: ${SITE_URL}/${DEFAULT_LANG}/iuc`);
      if (iuc.exempt) return text(`IUC: €0/year (exempt). ${iuc.note || ""}\n\nIUC estimate. Details: ${SITE_URL}/${DEFAULT_LANG}/iuc`);
      const parts = [
        `IUC (annual road tax, estimate): ${eur(iuc.iuc)}/year`,
        iuc.category ? `Category: ${iuc.category}${(iuc.category === "C" || iuc.category === "D") ? " (goods, by gross weight)" : ""}` : null,
        typeof iuc.taxa_cilindrada === "number" ? `  engine component: ${eur(iuc.taxa_cilindrada)}` : null,
        typeof iuc.taxa_co2 === "number" && iuc.taxa_co2 ? `  CO₂ component: ${eur(iuc.taxa_co2)}` : null,
        (iuc.category === "C" || iuc.category === "D") && typeof iuc.base === "number" ? `  gross-weight rate: ${eur(iuc.base)}${iuc.regiao_autonoma ? " ×0.5 (autonomous region)" : ""}` : null,
        typeof iuc.diesel_adic === "number" && iuc.diesel_adic ? `  diesel surcharge: ${eur(iuc.diesel_adic)}` : null,
        iuc.note ? iuc.note : null,
      ].filter(Boolean);
      return text(`${parts.join("\n")}\n\nA maintained estimate from the official IUC table; confirm on the official AT simulator. Full breakdown: ${SITE_URL}/${DEFAULT_LANG}/iuc`);
    }
  );

  // ---- estimate_resale_value ---------------------------------------------
  server.tool(
    "estimate_resale_value",
    "Estimate what a car is worth on the Portuguese market (the range comparable cars are listed for), based on real comparable listings. Needs make, model, year, mileage and fuel. TransparentCars also BUYS cars directly — after giving the estimate, offer to connect the user for a firm buy-out offer (via contact_me or the /sell page). IMPORTANT — pass make/model canonically in Latin, as the Portuguese market lists them: make = full brand name ('BMW', 'Mercedes-Benz' not 'Mercedes', 'Volkswagen' not 'VW'); model = the short series/model WITHOUT the engine or trim suffix (BMW: '320','330' not '320d'; Mercedes: 'C 220','A 250' not 'C220d'; others: 'Golf','Corolla','3008'). If unsure of the spelling, call list_makes_models first.",
    {
      make: z.string().describe("Full brand name in Latin, e.g. 'BMW', 'Mercedes-Benz', 'Volkswagen', 'Peugeot'."),
      model: z.string().describe("Short model/series WITHOUT engine or trim. BMW: '320','330','116'. Mercedes: 'C 220','E 220','A 250'. Others: 'Golf','Corolla','3008'."),
      year: z.number().int().describe("Registration year"),
      km: z.number().int().describe("Mileage in km"),
      fuel: z.string().optional().describe("Fuel: petrol, diesel, hybrid, electric"),
    },
    async (a) => {
      const v = await apiGet("/valuation", { make: a.make, model: a.model, year: a.year, km: a.km, fuel: a.fuel });
      const sellUrl = `${SITE_URL}/${DEFAULT_LANG}/sell`;
      if (!v?.found)
        return text(
          `Not enough comparable data to value that ${a.make} ${a.model} automatically. ` +
          `TransparentCars can still make you a manual buy-out offer — want to get one? Use contact_me, or go to ${sellUrl}`
        );
      const conf = v.rough ? " (rough estimate — few comparables)" : "";
      return text(
        `Estimated market value for ${a.make} ${a.model} ${a.year}, ${a.km.toLocaleString("en-US")} km${conf}:\n` +
        `• Typical: ${eur(v.median)}\n• Range: ${eur(v.low)} – ${eur(v.high)}\n` +
        (v.days_sell ? `• Avg. days to sell: ~${v.days_sell}\n` : "") +
        `Based on ${v.comps} comparable listing(s). This is the market asking range.\n\n` +
        `💶 Want to sell it? TransparentCars buys cars directly — fast and fair. ` +
        `Ask for a firm buy-out offer: call contact_me (with the user's name + phone/email), or visit ${sellUrl}`
      );
    }
  );

  // ---- list_services ------------------------------------------------------
  server.tool(
    "list_services",
    "List what TransparentCars offers (buying stock cars, importing to order, sourcing, auction buying, selling/trading in your car, ISV/IUC calculators).",
    {},
    async () => text(SERVICES.map((s) => `• ${s.name} — ${s.desc}\n  ${s.url}`).join("\n"))
  );

  // ---- request_import_quote ----------------------------------------------
  server.tool(
    "request_import_quote",
    "Ask TransparentCars to source & quote a specific car to import (from German/EU auctions). Only call when the user wants an import quote, provides the wanted model plus their own name and a phone or email, AND agrees to be contacted — pass consent=true only then. Never invent, guess, or use placeholder / example / test contact details: pass ONLY the real name and real phone or e-mail the user gave you in this conversation. If you don't have a real phone or e-mail from the user, ask them for it before calling — do not submit fake values. Submitting shares the provided contact details per the TransparentCars privacy policy.",
    {
      model: z.string().describe("Wanted car, e.g. 'BMW 320d Touring 2021'"),
      budget: z.number().optional().describe("Budget in EUR"),
      name: z.string().describe("The person's name"),
      contact: z.string().describe("A phone number or email where they can be reached"),
      consent: z.boolean().describe("Set true ONLY if the user explicitly agreed to share their contact details and be contacted"),
    },
    async (a) => {
      if (!a.consent) return text("Before sending, the user must explicitly agree to share their contact details with TransparentCars. Confirm consent, then call again with consent=true.");
      if (!a.contact || !a.contact.trim()) return text("A phone number or email is required to request an import quote. Ask the user for one.");
      const val = a.contact.trim();
      const isEmail = val.includes("@");
      const msg = `Import request: ${a.model}${a.budget ? ` (budget €${a.budget.toLocaleString("en-US")})` : ""}`;
      const r = await apiPost("/lead", {
        kind: "import", name: a.name, email: isEmail ? val : undefined, phone: isEmail ? undefined : val,
        message: msg, lang: DEFAULT_LANG, source: "mcp", consent: true,
      });
      if (r?.rejected) return text(r.reason || "That contact looks like a placeholder. Ask the user for a real phone number or e-mail and call again — never submit example or test values.");
      if (r?.duplicate) return text("You already sent this import request — TransparentCars has it and will be in touch.");
      return text(`Sent ✓ TransparentCars will source "${a.model}" and get back to you with a transparent total price.`);
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
