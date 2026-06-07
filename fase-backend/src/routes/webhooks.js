import { Router } from 'express';

import { getStripe } from '../config/stripe.js';

const router = Router();

function handlePaymentIntentSucceeded(paymentIntent) {
  console.info('[webhook] payment_intent.succeeded', {
    id: paymentIntent.id,
    amount: paymentIntent.amount,
    dealId: paymentIntent.metadata?.dealId,
    developerId: paymentIntent.metadata?.developerId,
  });
}

function handleAccountUpdated(account) {
  console.info('[webhook] account.updated', {
    id: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
  });
}

function handleTransferCreated(transfer) {
  console.info('[webhook] transfer.created', {
    id: transfer.id,
    amount: transfer.amount,
    destination: transfer.destination,
  });
}

router.post('/webhook', async (req, res) => {
  const stripe = getStripe();
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET is not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error) {
    console.error('[webhook] Signature verification failed:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        handlePaymentIntentSucceeded(event.data.object);
        break;
      case 'account.updated':
        handleAccountUpdated(event.data.object);
        break;
      case 'transfer.created':
        handleTransferCreated(event.data.object);
        break;
      default:
        console.info('[webhook] Unhandled event type:', event.type);
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('[webhook] Handler error:', error);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
});

export default router;
