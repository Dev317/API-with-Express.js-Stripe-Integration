const express = require('express');
const app = express();

require('dotenv').config();
const { STRIPE_SECRET_KEY, PRICE_API_ID, SIGNING_SECRET } = process.env;

const stripe = require('stripe')(`sk_test_${STRIPE_SECRET_KEY}`);

const customers = {
    // stripeCustomerId : data
    'stripeCustomerId': {
      apiKey: '123xyz',
      active: false,
      itemId: 'stripeSubscriptionItemId',
    },
  };

const apiKeys = {
    // apiKey : customerdata
    '123xyz': 'stripeCustomerId',
};

const generateAPIKey = () => {
    const { randomBytes } = require('crypto');
    const apiKey = randomBytes(16).toString('hex');
    const hashedAPIKey = hashAPIKey(apiKey);

    if (apiKeys[hashedAPIKey]) {
        generateAPIKey();
    } else {
        return { hashedAPIKey, apiKey };
    }
};

const hashAPIKey = (apiKey) => {
    const { createHash } = require('crypto');
    const hashedAPIKey = createHash('md5').update(apiKey).digest('hex');
    return hashedAPIKey;
};

app.get('/api', async (req, res) => {
    const { apiKey } = req.query;

    if (!apiKey) {
        res.sendStatus(400);
    }

    const hashedAPIKey = hashAPIKey(apiKey);

    const customerId = apiKeys[hashedAPIKey];
    const customer = customers[customerId];

    if (!customer || !customer.active) {
        res.sendStatus(403);
    } else {
        let record;
        try {
            record = await stripe.subscriptionItems.createUsageRecord(
                customer.itemId,
                {
                    quantity : 1,
                    timestamp : 'now',
                    action : 'increment'
                }
            );
        } catch (err) {
            console.log('Error creating record!');
        }

        res.send({ data : '😋', usage : record});
    }
});

app.post('/checkout', async (req, res) => {
    let session;
    try {
            session = await stripe.checkout.sessions.create({
            mode : 'subscription',
            payment_method_types : ['card'],
            line_items : [
                {
                    price : `price_${PRICE_API_ID}`
                }
            ],
            success_url : 'http://localhost:5000/dashboard?session_id={CHECKOUT_SESSION_ID}',
            cancel_url : 'http://localhost:5000/error'
        });
    } catch (err) {
        console.log('Error initiating session!');
    }
    

    res.send(session);
});

// Middleware required for Webhook Handler
app.use(
    express.json({
      verify: (req, res, buffer) => (req['rawBody'] = buffer),
    })
);

app.post('/webhook', async (req, res) => {
    let data;
    let eventType;
    // Check if webhook signing is configured.
    const webhookSecret = `whsec_${SIGNING_SECRET}`;
  
    if (webhookSecret) {
        // Retrieve the event by verifying the signature using the raw body and secret.
        let event;
        let signature = req.headers['stripe-signature'];
    
        try {
            event = stripe.webhooks.constructEvent(
            req['rawBody'],
            signature,
            webhookSecret
            );
        } catch (err) {
            console.log(`⚠️  Webhook signature verification failed.`);
            return res.sendStatus(400);
        }
        // Extract the object from the event.
        data = event.data;
        eventType = event.type;
    } else {
        // Webhook signing is recommended, but if the secret is not configured in `config.js`,
        // retrieve the event data directly from the request body.
        data = req.body.data;
        eventType = req.body.type;
    }
  
    switch (eventType) {
      case 'checkout.session.completed':
            console.log(data);

            const customerId = data.object.customer;
            const subscriptionId = data.object.subscription;

            console.log( `😊 Customer ${customerId} subscribed 💸 to plan ${subscriptionId}`);

            // Get the subscription. The first item is the plan the user subscribed to.
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            const itemId = subscription.items.data[0].id;

            // generate API key
            const { hashedAPIKey, apiKey } = generateAPIKey();
            console.log(`Generated user's unique API key : ${apiKey}`);
            console.log(`Hashed API key : ${hashedAPIKey}`);

            // store API keys into database
            customers[customerId] = { apiKey : hashedAPIKey, itemId, active : true };
            apiKeys[hashedAPIKey] = customerId;

            break;
      case 'invoice.paid':
            break;
      case 'invoice.payment_failed':
            break;
      default:
      // Unhandled event type
    }
  
    res.sendStatus(200);
});

app.get('/usage/:customer', async (req, res) => {
    const customerId = req.params.customer;
    let invoice;
    try {
        invoice = await stripe.invoices.retrieveUpcoming({
            customer: customerId,
        });
    } catch (err) {
        console.log('Error in sending invoice!');
    }

    res.send(invoice);
});

app.listen(8080, () => {
    console.log('Server is live on http://localhost:8080');
});