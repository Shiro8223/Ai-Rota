import "server-only";
import Stripe from "stripe";
import { audit } from "./audit";
import { db, now } from "./db";
import type { Organisation, Plan, Store } from "./types";

export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_STARTER);

let client: Stripe | null = null;
export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

export const PLANS: Record<Exclude<Plan, "trial">, { label: string; price: string; env: string }> = {
  starter: { label: "Starter", price: "£39 / location / month", env: "STRIPE_PRICE_STARTER" },
  pro: { label: "Pro", price: "£79 / location / month", env: "STRIPE_PRICE_PRO" },
};

/** Group volume pricing: 15% off from 5 sites, 20% off from 10. */
export function volumeDiscount(sites: number) {
  return sites >= 10 ? 0.2 : sites >= 5 ? 0.15 : 0;
}
export const LIST_PRICE: Record<Exclude<Plan, "trial">, number> = { starter: 39, pro: 79 };

/** One subscription for the whole group: quantity = number of sites, volume coupon applied. */
export async function groupCheckoutUrl(org: Organisation, plan: Exclude<Plan, "trial">, sites: number, email: string) {
  const price = process.env[PLANS[plan].env];
  if (!price) throw new Error(`${PLANS[plan].env} is not set`);
  const site = process.env.SITE_URL ?? "http://localhost:3000";
  const coupon = sites >= 10 ? process.env.STRIPE_COUPON_10PLUS : sites >= 5 ? process.env.STRIPE_COUPON_5PLUS : undefined;
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: sites }],
    ...(org.stripeCustomerId ? { customer: org.stripeCustomerId } : { customer_email: email }),
    client_reference_id: org.id,
    metadata: { orgId: org.id, plan },
    subscription_data: { metadata: { orgId: org.id, plan } },
    ...(coupon ? { discounts: [{ coupon }] } : { allow_promotion_codes: true }),
    success_url: `${site}/org/${org.id}/brand?billing=success`,
    cancel_url: `${site}/org/${org.id}/brand?billing=cancelled`,
  });
  return session.url!;
}

/** Stripe Checkout (hosted) for one location's subscription. 15-20% multi-site discounts are set up as Stripe coupons. */
export async function checkoutUrl(store: Store, plan: Exclude<Plan, "trial">, email: string) {
  const price = process.env[PLANS[plan].env];
  if (!price) throw new Error(`${PLANS[plan].env} is not set`);
  const site = process.env.SITE_URL ?? "http://localhost:3000";
  const trialDaysLeft = Math.max(0, Math.ceil((new Date(store.trialEndsAt).getTime() - Date.now()) / 86_400_000));
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    ...(store.stripeCustomerId ? { customer: store.stripeCustomerId } : { customer_email: email }),
    client_reference_id: store.id,
    metadata: { storeId: store.id, plan },
    subscription_data: { metadata: { storeId: store.id, plan }, ...(store.billingStatus === "trialing" && trialDaysLeft > 0 ? { trial_period_days: trialDaysLeft } : {}) },
    allow_promotion_codes: true,
    success_url: `${site}/s/${store.id}/settings?billing=success`,
    cancel_url: `${site}/s/${store.id}/settings?billing=cancelled`,
  });
  return session.url!;
}

export async function portalUrl(store: Store) {
  if (!store.stripeCustomerId) throw new Error("No Stripe customer yet");
  const site = process.env.SITE_URL ?? "http://localhost:3000";
  const s = await stripe().billingPortal.sessions.create({ customer: store.stripeCustomerId, return_url: `${site}/s/${store.id}/settings` });
  return s.url;
}

const STATUS: Record<string, Store["billingStatus"]> = {
  trialing: "trialing", active: "active", past_due: "past_due", unpaid: "past_due", incomplete: "past_due",
  canceled: "cancelled", incomplete_expired: "cancelled", paused: "past_due",
};

/** Apply a verified webhook event. */
export async function handleStripeEvent(event: Stripe.Event) {
  const d = await db();
  if (event.type === "checkout.session.completed" && event.data.object.metadata?.orgId) {
    const s = event.data.object;
    const orgId = s.metadata!.orgId;
    if (await d.get("organisations", orgId)) {
      await d.update("organisations", orgId, {
        stripeCustomerId: typeof s.customer === "string" ? s.customer : (s.customer?.id ?? null),
        stripeSubscriptionId: typeof s.subscription === "string" ? s.subscription : (s.subscription?.id ?? null),
        plan: (s.metadata?.plan as Plan) ?? "starter",
        billingStatus: "active",
      });
    }
    return;
  }
  if (event.type === "checkout.session.completed") {
    const s = event.data.object;
    const storeId = s.metadata?.storeId ?? s.client_reference_id;
    if (!storeId || !(await d.get("stores", storeId))) return;
    await d.update("stores", storeId, {
      stripeCustomerId: typeof s.customer === "string" ? s.customer : (s.customer?.id ?? null),
      stripeSubscriptionId: typeof s.subscription === "string" ? s.subscription : (s.subscription?.id ?? null),
      plan: (s.metadata?.plan as Plan) ?? "starter",
      cancelledAt: null,
    });
    await audit(storeId, "stripe", "billing.checkout_completed", { plan: s.metadata?.plan });
  }
  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    if (sub.metadata?.orgId && (await d.get("organisations", sub.metadata.orgId))) {
      const status = event.type === "customer.subscription.deleted" ? "cancelled" : (STATUS[sub.status] ?? "past_due");
      await d.update("organisations", sub.metadata.orgId, { billingStatus: status, stripeSubscriptionId: sub.id });
      return;
    }
    const storeId = sub.metadata?.storeId;
    if (!storeId || !(await d.get("stores", storeId))) return;
    const status = event.type === "customer.subscription.deleted" ? "cancelled" : (STATUS[sub.status] ?? "past_due");
    await d.update("stores", storeId, {
      billingStatus: status,
      stripeSubscriptionId: sub.id,
      ...(sub.metadata?.plan ? { plan: sub.metadata.plan as Plan } : {}),
      cancelledAt: status === "cancelled" ? now() : null,
    });
    await audit(storeId, "stripe", "billing.subscription_" + (event.type.split(".").pop() ?? "updated"), { status });
  }
}
