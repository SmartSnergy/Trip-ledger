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
- "price" is ALWAYS the unit price per single item (the app multiplies qty × price itself)
- qty defaults to 1
- For multi-unit lines like "0.99 x 2  1.98": qty=2, price=0.99 (unit price)
- For weight lines like "0.962 kg x 1.69 EUR/kg  1.63": qty=1, price=1.63 (total charged — only one "unit")
- For discount lines like "RABATT 20%  -0.36": qty=1, price=-0.36 (keep as single negative item)
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Verify caller is authenticated
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

    const { image_base64, media_type } = await req.json();
    if (!image_base64) return new Response(JSON.stringify({ error: "No image provided" }), { status: 400, headers: corsHeaders });

    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [{
          type: "image",
          source: {
            type: "base64",
            media_type: media_type || "image/jpeg",
            data: image_base64,
          },
        }, {
          type: "text",
          text: "Parse this receipt and return the JSON.",
        }],
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1] : text;
    const parsed = JSON.parse(jsonStr.trim());

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
