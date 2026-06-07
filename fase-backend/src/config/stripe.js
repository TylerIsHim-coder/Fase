import Stripe from 'stripe';

let stripeClient = null;

export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }

  return stripeClient;
}

export function getPublishableKey() {
  return process.env.STRIPE_PUBLISHABLE_KEY ?? null;
}
