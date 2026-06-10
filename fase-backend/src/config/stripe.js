import Stripe from 'stripe';

let stripeClient = null;

export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  if (!stripeClient) {
    // Pin a stable API version so Connect transfer params (e.g. source_transaction) stay supported.
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
    });
  }

  return stripeClient;
}

export function getPublishableKey() {
  return process.env.STRIPE_PUBLISHABLE_KEY ?? null;
}
