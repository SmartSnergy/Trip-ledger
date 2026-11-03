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

GERMAN TWO-LINE FORMAT — READ ROW BY ROW, NEVER SKIP AHEAD:
Process the receipt line by line from top to bottom. Never pair a price with an item on a different line — each price belongs to the nearest item line ABOVE it.

Many German receipts use a two-line format: item name + total price on one line, then a detail line immediately below it with unit info:
  PORREE           1,18 B      ← item line: name="Porree (leek)", total=€1.18
    2 Stk ×  0,59              ← detail line for PORREE: qty=2, unit price=€0.59 → use qty=2, price=0.59
  GURKE BIO        2,38 B      ← item line: name="Organic cucumber", total=€2.38
    2 Stk ×  1,19              ← detail line for GURKE BIO: qty=2, unit price=€1.19 → use qty=2, price=1.19
  BIO EIER OKT     7,98 B      ← item line: name="Organic eggs October", total=€7.98
    2 Stk ×  3,99              ← detail line for BIO EIER OKT: qty=2, unit price=€3.99 → use qty=2, price=3.99
  INGWER BIO       1,58 B      ← item line
    0,322 kg × 4,90 EUR/kg     ← weight detail for INGWER BIO: qty=1, price=1.58 (the total on the item line above)

CRITICAL RULES for two-line format:
- A line with ONLY "N Stk × PRICE" or "N.NNN kg × PRICE EUR/kg" and NO product name = detail line for the item IMMEDIATELY above. Do NOT make it a separate item. Do NOT skip it.
- The detail line tells you qty and unit price. The item line's price is the total (qty × unit_price) — use the unit_price from the detail line, not the total.
- For weight items: qty=1, price = the total price on the item line (the per-kg rate is informational only).
- NEVER associate a detail line with any item other than the one directly above it.
- For single-line formats "2 x 1,95  3,90" or "2 St 1,95 EUR  3,90": qty=2, price=1.95 (unit price, NOT 3.90).

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
- "Drinks" — water, juice, soft drinks, coffee, tea, oat milk, almond milk, soy milk, any plant-based drink, non-alcoholic beverages
- "Bread" — bread, bakery, pastries
- "Alcohol" — beer, wine, spirits, cider
- "Snacks" — sweets, chocolate, crisps, nuts, peanut butter, spreads, protein bars
- "Frozen" — frozen food items
- "House Supplies" — cleaning products, hygiene, toiletries, household non-food (bags, dishwasher tabs, cat litter, socks, etc.)
- "Consumables" — pantry staples: canned goods, pasta, rice, oil, spices, condiments, pulses (beans, chickpeas, lentils), tomatoes (canned/passata), sugar, flour`;

function extractJson(text: string) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  return JSON.parse((m ? m[1] : text).trim());
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
      max_tokens: 2048,
      system: systemContent as any,
      messages: [{
        role: "user",
        content: [
          imageContent(image_base64, mt),
          { type: "text", text: "Parse this receipt and return the JSON." },
        ],
      }],
    });

    const firstText = firstResp.content[0].type === "text" ? firstResp.content[0].text : "";
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

      const secondText = secondResp.content[0].type === "text" ? secondResp.content[0].text : "";
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
