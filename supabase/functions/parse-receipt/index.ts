import Anthropic from "npm:@anthropic-ai/sdk@0.30.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

const SYSTEM_PROMPT = `You are a receipt parser. Extract all line items from grocery/supermarket receipts.

Return ONLY valid JSON in this exact shape:
{
  "store": "store name",
  "date": "YYYY-MM-DD or null",
  "total": 0.00,
  "items": [
    { "name": "clean product name in English", "qty": 1, "price": 0.00, "category": "Veggies", "dietary_tags": [] }
  ]
}

dietary_tags is an array containing zero or more of: "vegan", "vegetarian", "contains_dairy", "contains_gluten", "contains_alcohol"
Rules for dietary_tags:
- All items are "vegan" if they contain no meat, dairy, eggs, honey, or animal products
- All items that are vegan OR dairy+egg-free are also "vegetarian"
- Add "contains_dairy" if the item contains milk, cheese, butter, cream, yoghurt, whey, casein (includes sauces/breads made with dairy)
- Add "contains_gluten" if the item contains wheat, rye, barley, spelt (bread, pasta, flour, beer, most baked goods, soy sauce)
- Add "contains_alcohol" if the item contains alcohol
- Most fresh fruit, vegetables, legumes, plain rice, and plain nuts are "vegan" + "vegetarian"

Rules:
QUANTITY AND PRICE RULES (read carefully — this is where mistakes happen):
- "price" is ALWAYS the unit price for ONE item. The app multiplies qty × price to get the line total.
- qty defaults to 1. Only set qty > 1 when the receipt EXPLICITLY shows a multiplier like "2 x 1.95" or "3 St × 0.85" on that same line.
- If the only number on a line is a single price (e.g. "Produkt  3,90"), set qty=1 and price=3.90 — do NOT infer any quantity.
- Numbers in the PRODUCT NAME (e.g. "2er Pack", "6-pack", "500ml", "12x") are product descriptions, NOT quantity multipliers. Set qty=1.
- For lines like "2 x 1,95  3,90" or "2 St 1,95 EUR  3,90": qty=2, price=1.95 (the unit price, NOT 3.90)
- For weight lines like "0.962 kg x 1.69 EUR/kg  1.63": qty=1, price=1.63 (only one charge)
DISCOUNT RULES (German receipts use many discount keywords — get these right):
- INCLUDE as a negative line item (qty=1, price=negative amount) when a discount appears BETWEEN items in the item list:
  e.g. "RABATT  -0,36", "Preisvorteil  -0,20", "COUPON  -0,50", "Treuerabatt  -0,30", "Gutschein  -1,00", "Aktion  -0,15", "Sofortrabatt  -0,40"
  Use the euro amount shown (negative). If only a percentage is shown with no euro amount, skip it.
- SKIP summary/footer savings lines — these are informational and the item prices already reflect the discount:
  e.g. "Ihr Preisvorteil heute: 2,50 EUR", "Sie sparten: 1,20 EUR", "Gesamtersparnis: 3,40 EUR", "Preisvorteil gesamt"
  The difference: footer lines say "you saved X in total today" and appear after all items near the payment section. Inline discounts appear right next to specific items in the item list and have a minus sign in the price column.
- NEVER use the line total as the price when qty > 1. If "2 x 1.95" gives a line total of "3.90", price=1.95 not 3.90.
- Skip tax summary rows, subtotals, payment lines, barcodes, store address lines
- Translate German item names to clear English (e.g. "Ganzes Hähnchen" → "Whole chicken")
- Clean up abbreviations (e.g. "K.champignons" → "Champignon mushrooms", "Bio-Eier OKT 10er" → "Organic eggs x10")

Categories (assign exactly one — be precise):
- "Fruit" — all fresh or dried fruit (bananas, apples, kiwi, grapes, oranges, plums, avocado, etc.)
- "Veggies" — all fresh vegetables (cucumber, carrot, fennel, broccoli, mushrooms, peppers, zucchini, pumpkin, onion, etc.)
- "Meat" — meat, poultry, fish, cold cuts, sausages (chicken, chorizo, kabanos, etc.)
- "Eggs" — eggs only (Bio-Eier, Eier, eggs — never put eggs in Dairy)
- "Dairy" — ONLY animal dairy: milk, cheese, yoghurt, cream, butter, sour cream, quark, crème fraîche, dairy desserts. NEVER plant-based items here.
- "Drinks" — water, juice, soft drinks, coffee, tea, oat milk, almond milk, soy milk, any plant-based drink, non-alcoholic beverages
- "Bread" — bread, bakery, pastries
- "Alcohol" — beer, wine, spirits, cider
- "Snacks" — sweets, chocolate, crisps, nuts, peanut butter, spreads, protein bars
- "Frozen" — frozen food items
- "House Supplies" — cleaning products, hygiene, toiletries, household non-food (dishwasher tabs, cat litter, socks, bags, etc.)
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
      model: "claude-haiku-4-5",
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
        model: "claude-haiku-4-5",
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

Please look at the receipt again very carefully and find ONLY the items that are missing from the list above. Look especially for:
- Inline discount lines (e.g. "Preisvorteil -0,20", "RABATT -0,36", "COUPON -0,50", "Sofortrabatt -0,40") that appear in the item list with a minus sign — these must be included as negative-price items
- Non-food items like socks, bags, batteries, household goods that are easy to miss
- Any other priced line between the first and last item that was skipped
Do NOT include footer/summary savings lines like "Ihr Preisvorteil heute" or "Sie sparten" — only inline discounts with a minus sign in the price column.
Do NOT repeat items already listed.

Return ONLY a JSON array of the missing items (no store/date/total wrapper):
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
