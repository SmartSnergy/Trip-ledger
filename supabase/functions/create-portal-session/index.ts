// Supabase Edge Function: create-portal-session
// Returns a Stripe Customer Portal URL so users can manage/cancel their subscription.
//
// Required secrets:
//   STRIPE_SECRET_KEY         — Stripe secret key
//   SUPABASE_URL              — auto-injected
//   SUPABASE_ANON_KEY         — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected

import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);

Deno.serve(async (req) => {
  // Verify the caller is an authenticated Supabase user
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response("Unauthorized", { status: 401 });

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
  if (authErr || !user) return new Response("Unauthorized", { status: 401 });

  // Look up their Stripe customer ID
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .single();

  if (!sub?.stripe_customer_id) {
    return new Response(
      JSON.stringify({ error: "No active subscription found." }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const { return_url } = await req.json().catch(() => ({}));

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: return_url || req.headers.get("origin") || "https://example.com",
  });

  return new Response(
    JSON.stringify({ url: session.url }),
    { headers: { "Content-Type": "application/json" } },
  );
});
