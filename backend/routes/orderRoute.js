const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Order = require('../models/Order');
const auth = require('../middleware/auth');
const nodemailer = require('nodemailer');
const router = express.Router();

// Email setup (using Gmail or any SMTP)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,     // ← Your email
    pass: process.env.EMAIL_PASS      // ← App password (see below)
  }
});

// Create Stripe Checkout Session + Save Order + Send Email
router.post('/checkout', auth, async (req, res) => {
  try {
    const { items, customerInfo } = req.body; // items + name, email, address

    // Create Stripe session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: items.map(item => ({
        price_data: {
          currency: 'usd',
          product_data: { name: `${item.name} (${item.variant || 'Standard'})` },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      })),
      mode: 'payment',
      success_url: `${req.headers.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/cart`,
      customer_email: customerInfo.email,
    });

    // Save order to MongoDB
    const order = new Order({
      userId: req.user.id,
      items,
      total: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
      customerInfo,
      stripeSessionId: session.id
    });
    await order.save();

    // === SEND EMAIL TO YOU (SHOP OWNER) ===
    const orderItems = items.map(i => 
      `- ${i.name} (${i.variant || 'Standard'}) × ${i.quantity} = $${(i.price * i.quantity).toFixed(2)}`
    ).join('\n');

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,  // ← Your email (receives orders)
      subject: `New Order #${order._id} - Alison's Chic & Classics`,
      text: `
        NEW ORDER RECEIVED!

        Customer: ${customerInfo.name}
        Email: ${customerInfo.email}
        Phone: ${customerInfo.phone}
        Address: ${customerInfo.address}

        Items:
        ${orderItems}

        Total: $${order.total.toFixed(2)}

        Payment: Processing via Stripe
        View in Dashboard: ${req.headers.origin}/admin/orders
      `.trim()
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) console.log('Email error:', error);
      else console.log('Email sent:', info.response);
    });

    // === SEND CONFIRMATION TO CUSTOMER ===
    const customerMail = {
      from: process.env.EMAIL_USER,
      to: customerInfo.email,
      subject: 'Order Confirmed - Alison\'s Chic & Classics',
      text: `
        Hi ${customerInfo.name},

        Thank you for your order! We’ve received your payment and are preparing your items.

        Order ID: #${order._id}
        Total: $${order.total.toFixed(2)}

        We’ll notify you when it ships.

        Questions? Reply to this email.

        — Alison's Chic & Classics
      `.trim()
    };

    transporter.sendMail(customerMail);

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
