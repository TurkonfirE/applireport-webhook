const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Vercel serverless function
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  
  // Get raw body as buffer
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const rawBody = Buffer.concat(chunks).toString('utf8');

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle successful payment
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_details?.email?.toLowerCase();

    if (customerEmail) {
      try {
        const { error } = await supabase
          .from('paid_users')
          .upsert(
            { 
              email: customerEmail, 
              stripe_customer_id: session.customer || 'unknown'
            },
            { onConflict: 'email' }
          );

        if (error) {
          console.error('Supabase error:', error);
          return res.status(500).json({ error: 'Database error' });
        }

        console.log('Added paid user:', customerEmail);
      } catch (err) {
        console.error('Error adding user:', err);
        return res.status(500).json({ error: 'Server error' });
      }
    }
  }

  res.status(200).json({ received: true });
};

// IMPORTANT: Disable body parsing for Stripe signature verification
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
