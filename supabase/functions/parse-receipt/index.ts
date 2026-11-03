import Anthropic from "npm:@anthropic-ai/sdk@0.30.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

const SYSTEM_PROMPT = `You are a receipt parser. Extract all line items from grocery/supermarket receipts.

CRITICAL: Your response must ALWAYS be valid JSON and nothing else. Never write explanatory text, apologies, or descriptions — not even one word outside the JSON block. If the image is rotated, sideways, upside-down, blurry, or partially visible, attempt to read it anyway and return the best JSON you can. If you truly cannot read anything, return: {"store":null,"date":null,"total":0,"items":[]}

Return ONLY valid JSON in this exact shape:
{
  "store": "store name",
  "date": "YYYY-MM-DD or null",
  "total": 0.00,
  "items": [
    { "name": "clean product name in English", "qty": 1, "price": 0.00, "category": "Veggies", "dietary_tags": [] }
  ]
}

STEP 1 — DETECT LANGUAGE: Identify the receipt language (German, French, Italian, Spanish, English, etc.) before parsing. Apply the language-specific abbreviation rules below. Most European supermarket receipts use heavy abbreviations — resolve them using both the abbreviation table AND the price as context clues.

STEP 2 — RESOLVE ABBREVIATIONS WITH PRICE CONTEXT:
When a product name is ambiguous or abbreviated, use the price to pick the correct interpretation. Examples:
- "CHAMP. WEISS" or "K.CHAMPIGNONS" at €1–€3 → white mushrooms (Champignons), category: Veggies — NOT champagne
- "MAISHAEHNCHEN" or "MAISHÄHNCHEN" at €8–€12 → corn-fed whole chicken, category: Meat — NOT corn on the cob (corn costs <€2)
- "APFEL SHAMPION" or "APFEL CHAMPION" → Champion apple (apple variety), category: Fruit — NOT champagne
- "LAUCHZWIEBELN" → spring onions / scallions, category: Veggies — NOT garlic snails
- If a price seems implausible for your first interpretation (e.g. €10 for a vegetable), reconsider — it is almost certainly a different product

GERMAN SUPERMARKET ABBREVIATIONS (resolve before translating to English):
Vegetables & Fruit:
- CHAMP. / CHAMPIG. / K.CHAMPIG. → Champignons = mushrooms (Veggies)
- MAISHAEHNCH. / MAISHÄHNCH. / MAISHAEHNCHEN → Maishähnchen = corn-fed chicken (Meat, ~€8–12)
- HAEHNCH. / HÄHNCH. / GANZES HAEHNCHEN → Hähnchen = whole chicken (Meat)
- LAUCHZWIEBELN → spring onions / scallions (Veggies)
- PORREE → leek (Veggies)
- BUSCHBOHNE / BUSCHBOHNEN → bush beans / green beans (Veggies)
- GURKE / GURKE BIO → cucumber (Veggies)
- ZUCCHINI GRUEN / GRÜN → green zucchini (Veggies)
- KUERBIS / KÜRBIS → pumpkin / squash (Veggies)
- KAROTTE / KAROTTEN BIO → carrot (Veggies)
- BLUMENKOHL → cauliflower (Veggies)
- FENCHEL → fennel (Veggies)
- INGWER → ginger (Veggies)
- FELDSALAT → lamb's lettuce (Veggies)
- ROTE BEETE / BETE → beetroot (Veggies)
- KOHLRABI → kohlrabi (Veggies)
- PAPRIKA → bell pepper (Veggies)
- SELLERIE → celery / celeriac (Veggies)
- APFEL SHAMPION / CHAMPION / ELSTAR / BOSKOP / JONAGOLD → apple variety (Fruit)
- APFELSINE → orange (Fruit)
- WEINTRAUB. → grapes (Fruit)
Meat & Protein:
- KABANOS → Kabanos sausage / thin smoked pork sausage (Meat)
- CHORIZO PIKANT / SCHARF → spicy chorizo (Meat)
- HACKFLEISCH → minced meat (Meat)
- SCHWEINEFLEISCH / SCHWEIN → pork (Meat)
- RINDFLEISCH / RIND → beef (Meat)
- PUTENBRUST → turkey breast (Meat)
- LACHS → salmon (Meat)
- KASSLER / KASSELER → smoked/cured pork chop or neck — category: Meat. CRITICAL: NOT dairy. The name sounds like "Käse" (cheese) but Kassler is a pork product.
- LEBERKÄSE / LEBERKAESE / LEBERKASE → Bavarian meat loaf — category: Meat. CRITICAL: NOT dairy despite "Käse" in the name. Contains no cheese.
- FLEISCHWURST → pork ring sausage (Meat)
- SCHINKEN / SCHINKENWURST → ham / cooked ham sausage (Meat)
- BRATWURST / BOCKWURST / WIENER / WEISSWURST / WEISSWURST → German sausage varieties (Meat)
- SALAMI → salami (Meat)
- HÄHNCHENBRUST / HAHNCHENBRUST / HÄHNCHENFILET → chicken breast / fillet (Meat)
- GARNELEN / SHRIMPS → prawns / shrimp (Meat)
- THUNFISCH → tuna (Meat)
- HERING → herring (Meat)
Dairy & Eggs:
- BIO EIER / FREILANDEIER + month abbreviation (OKT, NOV etc.) → organic eggs, pack size from "2 Stk" etc. (Eggs)
- QUARK → quark / curd cheese (Dairy)
- SCHMAND → sour cream (Dairy)
- SAHNE → cream (Dairy)
- JOGHURT / YOGHURT → yoghurt (Dairy)
Other:
- PFAND / PFAND EUR → bottle deposit — include as "Bottle deposit" (House Supplies)
- PAPIERTASCHE / TRAGETASCHE / PLASTIKTASCHE → shopping bag (House Supplies)
- GUARANA / GUARRANA → guarana (energy drink ingredient) — categorise by full product name
- PEANUT BUTTER → peanut butter (Snacks)
- ROHRZUCKER / RÜBENZUCKER / KOKOSBLÜTENZUCKER → cane/beet/coconut sugar → Consumables
- HAFERFLOCKEN / HAFER → oats → Consumables

STANDARDIZED ENGLISH VOCABULARY — always use EXACTLY these English words. Never use synonyms, even if they seem equally correct. Consistency matters above naturalness:
Meat / protein:
- Geflügel / geflügel / gefluegel → "poultry" (NEVER "chicken" unless the receipt says Hähnchen/Hühnchen/Haehnchen — those specifically mean chicken)
- Hähnchen / Hühnchen / Haehnchen / Huehnchen → "chicken"
- Rindfleisch / Rind → "beef"
- Schweinefleisch / Schwein → "pork"
- Wiener (sausage context) → "wiener sausage" (keep "Wiener" as the product type, do NOT drop it)
- Wurst → "sausage"
- Schinken → "ham"
- Speck → "bacon"
Dairy:
- gerieben / grated → "shredded" (e.g. "Shredded mozzarella", NOT "Grated mozzarella")
- Weidebutter / Weidemilch → "pasture butter" / "pasture milk"
- Süßrahmbutter / süßrahm → "sweet cream butter"
- Sahne → "cream"
- Schmand → "sour cream"
- Quark → "quark"
Confectionery / snacks:
- Schoko / Schokolade → "chocolate"
- Noisette → "hazelnut"
- Vollmilch (in chocolate context) → "milk chocolate"
- Zartbitter / dunkel (in chocolate context) → "dark chocolate"
Fruit & veg:
- Tomate / Tomaten → "tomato" / "tomatoes"
- Basilikum → "basil"
- Rote Bete / Rote Beete / Rüben → "beetroot"
- Rohrzucker → "cane sugar"
- Rübenzucker → "beet sugar"
Packaging / preparation descriptors (standardize these too):
- im Topf / en pot → "in pot" (e.g. "Basil in pot")
- Bio / Bioland / Biol. → "organic" (use once at the start, do not repeat)

KNOWN BRANDS — cross-reference brand name to override category guesses:
- KIRPA / BIO KIRPA → Kirpa is a HERBAL TEA brand. EVERY Kirpa product is tea → "Drinks". CRITICAL: "Kirpa Gold Kurkuma" = golden turmeric tea (NOT curry powder, NOT snack). "Kirpa Halsliebe" = throat-soothing herbal tea. Never put Kirpa in Snacks or Consumables.
- VOELKEL / VÖLKEL → organic juice / beverage brand → "Drinks"
- BIONADE → organic soft drink → "Drinks" + "contains_alcohol":false
- KLOSTERFRAU / DENN'S / ALNATURA → organic food brand — categorise by product type, not brand name

dietary_tags is an array containing zero or more of: "vegan", "vegetarian", "contains_dairy", "contains_gluten", "contains_alcohol"
- All items are "vegan" if they contain no meat, dairy, eggs, honey, or animal products
- All items that are vegan OR dairy+egg-free are also "vegetarian"
- Add "contains_dairy" if the item contains milk, cheese, butter, cream, yoghurt, whey, casein
- Add "contains_gluten" if the item contains wheat, rye, barley, spelt (bread, pasta, flour, beer, most baked goods)
- Add "contains_alcohol" if the item contains alcohol
- Most fresh fruit, vegetables, legumes, plain rice, and plain nuts are "vegan" + "vegetarian"

QUANTITY AND PRICE RULES (read carefully — this is where mistakes happen):
- "price" is ALWAYS the unit price for ONE item. The app multiplies qty × price to get the line total.
- qty defaults to 1. Only set qty > 1 when there is an EXPLICIT multiplier for that item.
- Numbers in the PRODUCT NAME (e.g. "2er Pack", "6-pack", "500ml", "12x") are product descriptions, NOT quantity multipliers. Set qty=1.

GERMAN RECEIPT FORMATS — READ ROW BY ROW, NEVER SKIP AHEAD:
Process the receipt TOP to BOTTOM. Each price belongs to the item on ITS OWN LINE ONLY. NEVER borrow a price from an adjacent line.

UNIVERSAL MULTIPLIER RULE: When you see a "×" or "x" between two numbers, one is always a whole integer (the quantity) and one is always a decimal (the unit price). Regardless of order: INTEGER = qty, DECIMAL = unit price. The line total at the end is ALWAYS ignored for pricing.
  "3,29 x 2  6,58 A"  → qty=2 (integer), price=3.29 (decimal). Line total 6.58 is ignored.
  "1,49 x 4  5,96 A"  → qty=4 (integer), price=1.49 (decimal). Line total 5.96 is ignored.
  "2 x 1,95  3,90"    → qty=2 (integer), price=1.95 (decimal). Line total 3.90 is ignored.
  "1,29 x 3  3,87 A"  → qty=3 (integer), price=1.29 (decimal). Line total 3.87 is ignored.
  "4,99 x 2  9,98 A"  → qty=2 (integer), price=4.99 (decimal). Line total 9.98 is ignored.

Items with NO multiplier on their line: qty=1, price = the single price shown. Use ONLY the price on that item's own line.
  "Heidelbeeren  5,69 A"  → qty=1, price=5.69
  "Kiwi          3,99 A"  → qty=1, price=3.99
  "Broccoli      1,49 A"  → qty=1, price=1.49

WEIGHT ITEMS (two-line, top of Lidl/Aldi receipts): item name on one line with NO price, then weight detail on the next line.
  "Fenchel" then "0,628 kg x 2,49 EUR/kg  1,56 A"  → name="Fennel", qty=1, price=1.56 (the line total — per-kg rate is informational only)
  "XXX-Fairtrade Bio Bananen" then "2,876 kg x 1,99 EUR/kg  5,72 A"  → name="Organic Fairtrade Bananas", qty=1, price=5.72

TWO-LINE FORMAT (REWE, Edeka, Kaufland): item name + total price on line 1, then a detail line below with unit info.
  "PORREE  1,18 B" then "2 Stk × 0,59"  → qty=2, price=0.59
  "GURKE BIO  2,38 B" then "2 Stk × 1,19"  → qty=2, price=1.19
  "INGWER BIO  1,58 B" then "0,322 kg × 4,90 EUR/kg"  → qty=1, price=1.58 (total from line above)
A line with ONLY "N Stk × price" or "N kg × rate EUR/kg" and NO product name is a detail line — do NOT make it a separate item.

DISCOUNT RULES (German receipts use many discount keywords — get these right):
- INCLUDE as a negative line item (qty=1, price=negative amount) when a discount appears BETWEEN items in the item list:
  e.g. "RABATT  -0,36", "Preisvorteil  -0,20", "COUPON  -0,50", "Treuerabatt  -0,30", "Gutschein  -1,00", "Aktion  -0,15", "Sofortrabatt  -0,40"
  Use the euro amount shown (negative). If only a percentage is shown with no euro amount, skip it.
- SKIP summary/footer savings lines — these are informational and the item prices already reflect the discount:
  e.g. "Ihr Preisvorteil heute: 2,50 EUR", "Sie sparten: 1,20 EUR", "Gesamtersparnis: 3,40 EUR", "Preisvorteil gesamt"
- NEVER use the line total as the price when qty > 1. If "2 x 1.95" gives a line total of "3.90", price=1.95 not 3.90.
- PFAND / PFAND EUR lines are bottle deposits — INCLUDE them as a line item so the total adds up. Use name "Bottle deposit", qty=1, price=the amount shown, category="House Supplies", dietary_tags=[].
- Skip tax summary rows (Steuer, MwSt), subtotals (SUMME, Gesamtbetrag), payment lines (Geg. BAR, Rückgeld), barcodes, store address lines, TSE-Signatur lines
- Translate all item names to clear English

STORE NAME — cross-reference the header text against known chains and use the canonical name:
German: REWE → "REWE", LIDL → "Lidl", ALDI → "Aldi", EDEKA → "Edeka", PENNY → "Penny", NETTO → "Netto", KAUFLAND → "Kaufland", TEGUT → "Tegut", ALNATURA → "Alnatura", DENN'S → "denn's Biomarkt", ROSSMANN → "Rossmann", DM-DROGERIE → "dm", OBI → "OBI", SATURN → "Saturn", MEDIA MARKT → "MediaMarkt"
Austria: BILLA → "Billa", SPAR → "Spar", HOFER → "Hofer", MERKUR → "Merkur"
Other EU: CARREFOUR → "Carrefour", LECLERC → "E.Leclerc", MERCADONA → "Mercadona", ALBERT HEIJN → "Albert Heijn", JUMBO → "Jumbo", COOP → "Coop", MIGROS → "Migros", ESSELUNGA → "Esselunga", SAINSBURY → "Sainsbury's", TESCO → "Tesco", WAITROSE → "Waitrose", MARKS SPENCER / M&S → "Marks & Spencer"
If the store name on the receipt doesn't match any known chain, use the name as printed (cleaned up, title-case).

Categories (assign exactly one — be precise):
- "Fruit" — all fresh or dried fruit (bananas, apples, kiwi, grapes, oranges, plums, avocado, etc.)
- "Veggies" — all fresh vegetables AND mushrooms (cucumber, carrot, fennel, broccoli, champignons, peppers, zucchini, pumpkin, onion, spring onions, leek, beans, etc.)
- "Meat" — meat, poultry, fish, cold cuts, sausages (chicken, chorizo, kabanos, salmon, etc.)
- "Eggs" — eggs only (Bio-Eier, Eier, eggs — never put eggs in Dairy)
- "Dairy" — ONLY animal dairy: milk, cheese, yoghurt, cream, butter, sour cream, quark, crème fraîche. NEVER plant-based items here.
- "Drinks" — water, juice, soft drinks, coffee, ALL tea (herbal tea, green tea, black tea, chai, turmeric tea, throat tea — any tea bag or loose tea product), oat milk, almond milk, soy milk, any plant-based drink, non-alcoholic beverages
- "Bread" — bread, bakery, pastries
- "Alcohol" — beer, wine, spirits, cider
- "Snacks" — sweets, chocolate, crisps, nuts, peanut butter, spreads, protein bars
- "Frozen" — frozen food items
- "House Supplies" — cleaning products, hygiene, toiletries, household non-food (bags, dishwasher tabs, cat litter, socks, etc.)
- "Consumables" — pantry staples: canned goods, pasta, rice, oil, spices, condiments, pulses (beans, chickpeas, lentils), tomatoes (canned/passata), sugar, flour`;

const EMPTY_PARSE = { store: null, date: null, total: 0, items: [] };

function extractJson(text: string) {
  try {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    return JSON.parse((m ? m[1] : text).trim());
  } catch (_) {
    // Response was not valid JSON (truncated or model added prose).
    // Try to salvage a partial items array if present.
    try {
      const arrM = text.match(/"items"\s*:\s*(\[[\s\S]*)/);
      if (arrM) {
        // Find the last complete item object by trimming after the last complete }
        const raw = arrM[1];
        const lastClose = raw.lastIndexOf("},");
        if (lastClose > 0) {
          const partial = JSON.parse(raw.slice(0, lastClose + 1) + "]");
          if (Array.isArray(partial) && partial.length > 0) {
            const storeM = text.match(/"store"\s*:\s*"([^"]+)"/);
            const dateM = text.match(/"date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
            const totalM = text.match(/"total"\s*:\s*([\d.]+)/);
            return {
              store: storeM ? storeM[1] : null,
              date: dateM ? dateM[1] : null,
              total: totalM ? parseFloat(totalM[1]) : 0,
              items: partial,
            };
          }
        }
      }
    } catch (_2) { /* ignore salvage failure */ }
    return { ...EMPTY_PARSE };
  }
}

function itemsSum(items: Array<{ qty: number; price: number }>): number {
  return Math.round(items.reduce((s, it) => s + (it.qty || 1) * it.price, 0) * 100) / 100;
}

const imageContent = (base64: string, mediaType: string) => ({
  type: "image" as const,
  source: { type: "base64" as const, media_type: mediaType as "image/jpeg", data: base64 },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

    const { image_base64, media_type, custom_categories } = await req.json();
    if (!image_base64) return new Response(JSON.stringify({ error: "No image provided" }), { status: 400, headers: corsHeaders });

    const mt = media_type || "image/jpeg";

    // Build system content: cached base prompt + optional custom categories
    type SystemBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
    const systemContent: SystemBlock[] = [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ];
    if (Array.isArray(custom_categories) && custom_categories.length > 0) {
      const extra = custom_categories
        .map((c: { name: string; description: string }) => `- "${c.name}" — ${c.description}`)
        .join("\n");
      systemContent.push({
        type: "text",
        text: `\nAdditional custom categories (use these when items clearly match — prefer over standard categories when applicable):\n${extra}`,
      });
    }

    // ── First pass: full parse ────────────────────────────────────────────────
    const firstResp = await client.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 4096,
      system: systemContent as any,
      messages: [{
        role: "user",
        content: [
          imageContent(image_base64, mt),
          { type: "text", text: "Parse this receipt and return the JSON." },
        ],
      }],
    });

    const firstText = (firstResp.content.find((b: { type: string }) => b.type === "text") as { type: string; text: string } | undefined)?.text ?? "";
    console.log("parse-receipt model response (first 2000 chars):", firstText.slice(0, 2000));
    const parsed = extractJson(firstText);
    const receiptTotal = parsed.total ? Math.round(Number(parsed.total) * 100) / 100 : 0;
    const sum1 = itemsSum(parsed.items || []);
    const gap = Math.round((receiptTotal - sum1) * 100) / 100;

    // ── Second pass: hunt for missed items if gap > €0.10 ────────────────────
    if (receiptTotal > 0 && Math.abs(gap) > 0.10) {
      const alreadyFound = (parsed.items || [])
        .map((it: { name: string; qty: number; price: number }) =>
          `- ${it.name}: qty ${it.qty}, price €${it.price}`
        )
        .join("\n");

      const secondResp = await client.messages.create({
        model: "claude-haiku-5-5",
        max_tokens: 1024,
        system: systemContent as any,
        messages: [{
          role: "user",
          content: [
            imageContent(image_base64, mt),
            {
              type: "text",
              text: `I already found these items (totalling €${sum1.toFixed(2)}):
${alreadyFound}

The receipt total is €${receiptTotal.toFixed(2)}, so there is a gap of €${gap.toFixed(2)} unaccounted for.

Scan the receipt again line by line and find ONLY items genuinely missing from the list above. The items above were already found — do NOT include them again even if you spot them on the receipt. Look especially for:
- Inline discount lines with a minus sign in the price column (e.g. "Preisvorteil -0,20", "RABATT -0,36") — include as negative-price items
- Non-food items (bags, batteries, household goods) that are easy to miss
- PFAND / bottle deposit lines — include as "Bottle deposit"
Do NOT include: footer savings summaries ("Ihr Preisvorteil heute", "Sie sparten"), tax rows, payment lines, subtotals.
Do NOT repeat any item already in the list above — if you are unsure whether an item is new, leave it out.

If there are no genuinely new items, return an empty array: []
Otherwise return ONLY a JSON array (no wrapper object):
[{ "name": "...", "qty": 1, "price": 0.00, "category": "...", "dietary_tags": [] }]`,
            },
          ],
        }],
      });

      const secondText = (secondResp.content.find((b: { type: string }) => b.type === "text") as { type: string; text: string } | undefined)?.text ?? "";
      try {
        // Extract either a bare array or the items field from an object
        const arrMatch = secondText.match(/\[[\s\S]*\]/);
        if (arrMatch) {
          const extraItems = JSON.parse(arrMatch[0]);
          if (Array.isArray(extraItems) && extraItems.length > 0) {
            parsed.items = [...(parsed.items || []), ...extraItems];
          }
        }
      } catch (_) {
        // Second pass parse failed — keep first-pass result
      }
    }

    // Deduplicate items by name+price before returning (guards against second-pass re-finding items)
    if (Array.isArray(parsed.items)) {
      const seen = new Set<string>();
      parsed.items = parsed.items.filter((it: { name: string; price: number }) => {
        const key = `${(it.name || "").trim().toLowerCase()}|${it.price}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("parse-receipt error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
