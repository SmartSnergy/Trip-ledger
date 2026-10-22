// Supabase Edge Function: stripe-webhook
// Handles Stripe events and keeps the subscriptions table in sync.
//
// Required secrets (set via: supabase secrets set KEY=value):
//   STRIPE_SECRET_KEY       — from Stripe Dashboard → Developers → API keys
//   STRIPE_WEBHOOK_SECRET   — from Stripe Dashboard → Webhooks → signing secret
//   SUPABASE_URL            — auto-injected by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase

import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response("Bad signature", { status: 400 });
  }

  console.log("Stripe event:", event.type);

  try {
    switch (event.type) {
      // ── User completed checkout ────────────────────────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        if (!userId) { console.warn("No client_reference_id on session"); break; }

        const subscriptionId = session.subscription as string;
        const customerId = session.customer as string;
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const plan = sub.items.data[0].price.recurring?.interval === "month"
          ? "monthly"
          : "yearly";
        const periodEnd = new Date(sub.current_period_end * 1000).toISOString();

        await supabase.from("subscriptions").upsert({
          user_id:                userId,
          status:                 "active",
          stripe_customer_id:     customerId,
          stripe_subscription_id: subscriptionId,
          plan,
          current_period_end:     periodEnd,
        }, { onConflict: "user_id" });
        break;
      }

      // ── Renewal paid ──────────────────────────────────────────────────────
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.billing_reason === "subscription_create") break; // already handled above
        const subId = invoice.subscription as string;
        if (!subId) break;

        const sub = await stripe.subscriptions.retrieve(subId);
        const periodEnd = new Date(sub.current_period_end * 1000).toISOString();

        await supabase.from("subscriptions")
          .update({ status: "active", current_period_end: periodEnd })
          .eq("stripe_subscription_id", subId);
        break;
      }

      // ── Payment failed ────────────────────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoice.subscription as string;
        if (!subId) break;

        await supabase.from("subscriptions")
          .update({ status: "expired" })
          .eq("stripe_subscription_id", subId);
        break;
      }

      // ── Subscription cancelled ────────────────────────────────────────────
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await supabase.from("subscriptions")
          .update({ status: "cancelled" })
          .eq("stripe_subscription_id", sub.id);
        break;
      }

      // ── Subscription updated (plan change, etc.) ──────────────────────────
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const periodEnd = new Date(sub.current_period_end * 1000).toISOString();
        const plan = sub.items.data[0].price.recurring?.interval === "month"
          ? "monthly"
          : "yearly";

        await supabase.from("subscriptions")
          .update({
            status: sub.status === "active" ? "active" : "expired",
            plan,
            current_period_end: periodEnd,
          })
          .eq("stripe_subscription_id", sub.id);
        break;
      }

      default:
        console.log("Unhandled event type:", event.type);
    }
  } catch (err) {
    console.error("Handler error:", err);
    return new Response("Internal error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
