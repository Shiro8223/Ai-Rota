import { NextResponse } from "next/server";
import { handleStripeEvent, stripe } from "@/lib/billing";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");
  if (!secret || !sig) return NextResponse.json({ error: "webhook not configured" }, { status: 400 });
  let event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), sig, secret);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }
  await handleStripeEvent(event);
  return NextResponse.json({ received: true });
}
