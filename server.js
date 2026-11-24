require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const express = require('express');
const mongoose = require('mongoose');

const orderEvents = new EventEmitter();
orderEvents.setMaxListeners(100);

function formatPublicOrder(order) {
  const obj = typeof order.toObject === 'function' ? order.toObject() : { ...order };
  if (obj.customerPhone) {
    obj.customerPhone = String(obj.customerPhone).replace(/.(?=.{4})/g, '*');
  }
  return obj;
}

function broadcastOrderUpdate(order) {
  if (!order || !order.orderCode) return;
  const masked = formatPublicOrder(order);
  orderEvents.emit(order.orderCode, masked);
}
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const Restaurant = require('./models/Restaurant');
const Order = require('./models/Order');
const User = require('./models/User');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set in .env and be at least 32 characters long.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://checkout.razorpay.com"], scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
        imgSrc: ["'self'", "data:", "https://images.unsplash.com", "https://plus.unsplash.com", "https://*.razorpay.com"],
        frameSrc: ["'self'", "https://api.razorpay.com", "https://checkout.razorpay.com"],
        connectSrc: ["'self'", "https://api.razorpay.com", "https://lumberjack.razorpay.com"]
      }
    }
  })
);

app.use(express.json({ limit: '10kb' }));
app.use((req, res, next) => { if (req.body) mongoSanitize.sanitize(req.body); if (req.params) mongoSanitize.sanitize(req.params); if (req.query) mongoSanitize.sanitize(req.query); next(); });

app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (mongoose.connection.readyState !== 1) return res.status(503).json({ status: 'error' });
  return res.status(200).json({ status: 'ok' });
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP. Please try again later.' }
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please wait 15 minutes and try again.' }
});

const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Order limit reached. Please wait a few minutes before placing another order.' }
});

app.use(express.static(path.join(__dirname, 'public')));

const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234';

function signUserToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '7d' }
  );
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] });
      req.user = { id: payload.sub, role: payload.role };
    } catch (_) {}
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  return next();
}

function requireDeliveryPartner(req, res, next) {
  if (!req.user || (req.user.role !== 'delivery_partner' && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Delivery partner privileges required' });
  }
  return next();
}

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

function sanitizeImageUrl(url) {
  const fallback = 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=80';
  if (typeof url !== 'string') return fallback;
  const trimmed = url.trim();
  return /^https:\/\/[^\s]+$/i.test(trimmed) ? trimmed.slice(0, 500) : fallback;
}

app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : undefined;
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (name.length < 2 || name.length > 60) {
      return res.status(400).json({ error: 'Name must be between 2 and 60 characters' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({ error: 'Password must be between 8 and 72 characters' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const isAdminEmail =
      process.env.ADMIN_EMAIL &&
      email === process.env.ADMIN_EMAIL.trim().toLowerCase();

    const assignedRole = isAdminEmail
      ? 'admin'
      : (req.body.role === 'delivery_partner' ? 'delivery_partner' : 'customer');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name,
      email,
      phone,
      passwordHash,
      role: assignedRole
    });
    const token = signUserToken(user);

    return res.status(201).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role }
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    return res.status(400).json({ error: err.message || 'Registration failed' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !password || password.length > 72) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = await User.findOne({ email }).select('+passwordHash');
    const isMatch = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);

    if (!user || !isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signUserToken(user);
    return res.status(200).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Authentication failed' });
  }
});

app.post('/api/auth/direct-login', authLimiter, async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    const user = await User.findOne({ email }).select('+passwordHash');

    if (password === '__PROBE_ONLY__') {
      return res.status(200).json({
        exists: Boolean(user),
        email,
        role: user ? user.role : null
      });
    }

    if (!user) {
      return res.status(404).json({ error: 'No account found with this email in database' });
    }

    // Admin security check: never allow passwordless login for admin accounts
    if (user.role === 'admin') {
      if (!password) {
        return res.status(401).json({ error: 'Admin accounts require standard password sign-in' });
      }
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid password for admin account' });
      }
    } else if (password) {
      // If a password was provided for customer or delivery partner, verify it
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid password for this account' });
      }
    }

    const token = signUserToken(user);
    return res.status(200).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Direct login failed' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({ id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

app.get('/api/restaurants', async (req, res) => {
  try {
    const { search, veg, fast, sort } = req.query;
    const query = {};

    if (veg === 'true') query.isPureVeg = true;
    if (fast === 'true') query.deliveryTime = { $lte: 30 };
    if (search && typeof search === 'string') {
      const safeSearch = escapeRegex(search.slice(0, 50));
      query.$or = [
        { name: { $regex: safeSearch, $options: 'i' } },
        { cuisines: { $regex: safeSearch, $options: 'i' } },
        { 'menu.name': { $regex: safeSearch, $options: 'i' } }
      ];
    }

    const sortMap = { rating: { rating: -1 }, time: { deliveryTime: 1 }, costLow: { costForTwo: 1 } };
    const restaurants = await Restaurant.find(query).sort(sortMap[sort] || {});
    return res.json(restaurants);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch restaurants' });
  }
});

app.post('/api/orders', orderLimiter, optionalAuth, async (req, res) => {
  try {
    const { restaurantId, items, couponCode, tip = 0, paymentMethod, customerName, customerPhone, deliveryAddress } = req.body;

    if (!mongoose.Types.ObjectId.isValid(restaurantId) || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid order payload' });
    }

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

    let itemTotal = 0;
    const verifiedItems = [];

    for (const cartItem of items) {
      const dbItem = restaurant.menu.id(cartItem.menuItemId);
      const qty = Math.min(Math.max(parseInt(cartItem.qty, 10) || 1, 1), 20);
      if (!dbItem) return res.status(400).json({ error: 'One or more menu items are invalid' });

      itemTotal += dbItem.price * qty;
      verifiedItems.push({ menuItemId: dbItem._id, name: dbItem.name, qty, unitPrice: dbItem.price });
    }

    let discount = 0;
    let deliveryFee = itemTotal >= 299 ? 0 : 35;

    if (couponCode === 'TRUE50' && itemTotal >= 199) {
      discount = Math.min(Math.round(itemTotal * 0.5), 100);
    } else if (couponCode === 'FREEDEL') {
      deliveryFee = 0;
    }

    const safeTip = Math.min(Math.max(Number(tip) || 0, 0), 500);
    const tax = Math.round((itemTotal - discount) * 0.05);
    const grandTotal = itemTotal - discount + deliveryFee + tax + safeTip;

    const orderCode = 'TH-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const isCod = paymentMethod === 'COD';

    const newOrder = await Order.create({
      orderCode,
      userId: req.user ? req.user.id : null,
      customerName,
      customerPhone,
      deliveryAddress,
      restaurantId: restaurant._id,
      restaurantName: restaurant.name,
      items: verifiedItems,
      itemTotal,
      deliveryFee,
      tax,
      discount,
      tip: safeTip,
      grandTotal,
      paymentMethod: isCod ? 'COD' : 'RAZORPAY',
      paymentStatus: isCod ? 'COD' : 'PENDING'
    });

    return res.status(201).json(newOrder);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Could not place order' });
  }
});

app.post('/api/payments/razorpay/order', orderLimiter, async (req, res) => {
  try {
    const { orderId, orderCode } = req.body;
    const order = mongoose.Types.ObjectId.isValid(orderId)
      ? await Order.findById(orderId)
      : await Order.findOne({ orderCode: String(orderCode || '').toUpperCase() });

    if (!order) return res.status(404).json({ error: 'Order not found' });

    const amountPaise = Math.max(Math.round(order.grandTotal * 100), 100);
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return res.json({
        mode: 'simulator',
        orderId: order._id,
        orderCode: order.orderCode,
        amount: amountPaise,
        currency: 'INR'
      });
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: order.orderCode
      })
    });

    const rzpOrder = await rzpRes.json();
    if (!rzpRes.ok) {
      return res.status(502).json({ error: rzpOrder.error?.description || 'Failed to initiate Razorpay order' });
    }

    order.razorpayOrderId = rzpOrder.id;
    await order.save();

    return res.json({
      mode: 'razorpay',
      keyId,
      razorpayOrderId: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      orderId: order._id,
      orderCode: order.orderCode
    });
  } catch (err) {
    return res.status(500).json({ error: 'Payment initialization error' });
  }
});

app.post('/api/payments/razorpay/verify', orderLimiter, async (req, res) => {
  try {
    const { orderId, orderCode, razorpay_order_id, razorpay_payment_id, razorpay_signature, simulated } = req.body;

    const order = mongoose.Types.ObjectId.isValid(orderId)
      ? await Order.findById(orderId)
      : await Order.findOne({ orderCode: String(orderCode || '').toUpperCase() });

    if (!order) return res.status(404).json({ error: 'Order not found' });

    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (keySecret && !simulated) {
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: 'Missing Razorpay payment signature fields' });
      }

      const expectedSig = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      const sigBuf = Buffer.from(String(razorpay_signature), 'utf8');
      const expBuf = Buffer.from(expectedSig, 'utf8');

      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return res.status(400).json({ error: 'Invalid payment signature' });
      }

      order.razorpayOrderId = razorpay_order_id;
      order.razorpayPaymentId = razorpay_payment_id;
    } else if (!keySecret && simulated) {
      order.razorpayPaymentId = 'pay_sim_' + crypto.randomBytes(4).toString('hex');
    } else {
      return res.status(400).json({ error: 'Payment verification rejected' });
    }

    order.paymentStatus = 'PAID';
    await order.save();
    broadcastOrderUpdate(order);

    return res.json({ verified: true, order });
  } catch (err) {
    return res.status(500).json({ error: 'Payment verification failed' });
  }
});

app.get('/api/orders/my', requireAuth, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(20);
    return res.json(orders);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load order history' });
  }
});

app.get('/api/orders/:orderCode', async (req, res) => {
  try {
    const code = String(req.params.orderCode).toUpperCase().replace(/[^A-Z0-9-]/g, '');
    const order = await Order.findOne({ orderCode: code }).lean();
    if (!order) return res.status(404).json({ error: 'Order not found' });

    return res.json(formatPublicOrder(order));
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve order' });
  }
});

app.get('/api/orders/:orderCode/stream', async (req, res) => {
  try {
    const code = String(req.params.orderCode).toUpperCase().replace(/[^A-Z0-9-]/g, '');
    const order = await Order.findOne({ orderCode: code }).lean();
    if (!order) return res.status(404).json({ error: 'Order not found' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });

    res.write(`data: ${JSON.stringify(formatPublicOrder(order))}\n\n`);

    const onUpdate = (updated) => {
      res.write(`data: ${JSON.stringify(updated)}\n\n`);
    };

    orderEvents.on(code, onUpdate);

    const ping = setInterval(() => {
      res.write(': ping\n\n');
    }, 20000);

    req.on('close', () => {
      clearInterval(ping);
      orderEvents.off(code, onUpdate);
    });
  } catch (err) {
    return res.status(500).end();
  }
});

app.get('/api/admin/orders', requireAuth, requireAdmin, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(50);
    return res.json(orders);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load admin orders' });
  }
});

app.patch('/api/admin/orders/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    const allowedStatuses = ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'];
    const status = String(req.body.status || '').toUpperCase();

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid order status' });
    }

    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    broadcastOrderUpdate(order);

    return res.json(order);
  } catch (err) {
    return res.status(400).json({ error: 'Failed to update order status' });
  }
});

app.get('/api/delivery/orders', requireAuth, requireDeliveryPartner, async (req, res) => {
  try {
    const orders = await Order.find({
      $or: [
        { status: 'PREPARING' },
        { assignedPartnerId: req.user.id }
      ]
    }).sort({ createdAt: -1 }).limit(40);
    return res.json(orders);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch delivery orders' });
  }
});

app.patch('/api/delivery/orders/:id/claim', requireAuth, requireDeliveryPartner, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.assignedPartnerId && order.assignedPartnerId.toString() !== req.user.id) {
      return res.status(409).json({ error: 'Order already claimed by another delivery partner' });
    }

    const partner = await User.findById(req.user.id);
    order.assignedPartnerId = req.user.id;
    order.assignedPartnerName = partner ? partner.name : 'Delivery Partner';
    await order.save();
    broadcastOrderUpdate(order);

    return res.json(order);
  } catch (err) {
    return res.status(400).json({ error: 'Failed to claim delivery order' });
  }
});

app.patch('/api/delivery/orders/:id/status', requireAuth, requireDeliveryPartner, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (req.user.role !== 'admin' && String(order.assignedPartnerId) !== String(req.user.id)) {
      return res.status(403).json({ error: 'You must claim this order before updating its status' });
    }

    const allowedStatuses = ['OUT_FOR_DELIVERY', 'DELIVERED'];
    const status = String(req.body.status || '').toUpperCase();

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid delivery status update. Allowed: OUT_FOR_DELIVERY, DELIVERED' });
    }

    order.status = status;
    await order.save();
    broadcastOrderUpdate(order);

    return res.json(order);
  } catch (err) {
    return res.status(400).json({ error: 'Failed to update delivery status' });
  }
});

app.post('/api/admin/restaurants', requireAuth, requireAdmin, async (req, res) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
    if (name.length < 2) {
      return res.status(400).json({ error: 'Restaurant name is required' });
    }

    const rawCuisines = Array.isArray(req.body.cuisines)
      ? req.body.cuisines
      : String(req.body.cuisines || 'North Indian').split(',');

    const cuisines = rawCuisines
      .map((c) => String(c).trim().slice(0, 30))
      .filter(Boolean)
      .slice(0, 8);

    const restaurant = await Restaurant.create({
      name,
      cuisines: cuisines.length ? cuisines : ['Homestyle'],
      rating: 4.3,
      deliveryTime: Math.min(Math.max(Number(req.body.deliveryTime) || 30, 10), 90),
      costForTwo: Math.min(Math.max(Number(req.body.costForTwo) || 300, 50), 5000),
      isPureVeg: Boolean(req.body.isPureVeg),
      offerText: typeof req.body.offerText === 'string' ? req.body.offerText.trim().slice(0, 40) : 'FLAT ₹100 OFF',
      location: typeof req.body.location === 'string' ? req.body.location.trim().slice(0, 80) : 'Indirapuram, Ghaziabad',
      fssai: typeof req.body.fssai === 'string' ? req.body.fssai.replace(/[^0-9]/g, '').slice(0, 14) : '12723055000999',
      image: sanitizeImageUrl(req.body.image),
      menu: []
    });

    return res.status(201).json(restaurant);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to add restaurant' });
  }
});

app.post('/api/admin/restaurants/:id/menu', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid restaurant ID' });
    }

    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

    const dishName = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
    const price = Number(req.body.price);

    if (dishName.length < 2 || !Number.isFinite(price) || price < 1 || price > 10000) {
      return res.status(400).json({ error: 'Valid dish name and price (₹1–₹10,000) are required' });
    }

    restaurant.menu.push({
      name: dishName,
      price: Math.round(price),
      category: typeof req.body.category === 'string' ? req.body.category.trim().slice(0, 40) || 'Mains' : 'Mains',
      isVeg: req.body.isVeg !== false,
      isBestseller: Boolean(req.body.isBestseller),
      description: typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 200) : ''
    });

    await restaurant.save();
    return res.status(201).json(restaurant);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to add menu item' });
  }
});

app.delete('/api/admin/restaurants/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid restaurant ID' });
    }

    const deleted = await Restaurant.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Restaurant not found' });

    return res.json({ message: 'Restaurant removed', id: req.params.id });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete restaurant' });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Securely connected to MongoDB Atlas');
    app.listen(PORT, () => console.log(`TrueHomes full-stack server running on port ${PORT}`));
  })
  .catch((err) => console.error('Database connection failed:', err.message));