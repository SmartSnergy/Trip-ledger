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
    { "name": "clean product name in English", "qty": 1, "price": 0.00, "category": "Veggies" }
  ]
}

Rules:
- "price" is the TOTAL price for that line (qty × unit price already calculated)
- qty defaults to 1
- Skip tax summary rows, subtotals, payment lines, discount rows, barcodes, store address
- Include discount lines as negative-price items only if they're product-specific (e.g. RABATT on a product)
- Translate German item names to clear English (e.g. "Ganzes Hähnchen" → "Whole chicken")
- Clean up abbreviations (e.g. "K.champignons" → "Champignon mushrooms", "Bio-Eier OKT 10er" → "Organic eggs x10")
- For weight items like "0.962 kg x 1.69 EUR/kg = 1.63" use qty:1, price:1.63 (the actual charged amount)
- For multi-unit like "0.99 x 2" use qty:2, price:1.98 (total), OR qty:2, price:0.99 (unit) — use total

Categories (assign exactly one):
- "Veggies" — fresh produce, fruit, vegetables
- "Meat" — meat, fish, poultry, cold cuts
- "Dairy" — eggs, milk, cheese, yoghurt, cream
- "Bread" — bread, bakery items
- "Drinks" — water, juice, soft drinks, coffee, tea
- "Alcohol" — beer, wine, spirits
- "Snacks" — sweets, crisps, chocolate, nuts, spreads
- "Frozen" — frozen food
- "House Supplies" — cleaning, hygiene, non-food household items
- "Consumables" — cooking staples, canned goods, pasta, rice, oil, spices, condiments`;

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
