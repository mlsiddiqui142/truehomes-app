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
  delete obj.customerName;
  delete obj.deliveryAddress;
  if (obj.customerPhone) {
    obj.customerPhone = String(obj.customerPhone).replace(/.(?=.{4})/g, '*');
  }
  return obj;
}

function broadcastOrderUpdate(order) {
  if (!order || !order.orderCode) return;
  const value = typeof order.toObject === 'function' ? order.toObject() : { ...order };
  orderEvents.emit(order.orderCode, value);
  orderEvents.emit('admin-orders', value);
}

const ORDER_TRANSITIONS = {
  CONFIRMED: ['PREPARING'],
  PREPARING: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: []
};

function canTransitionOrderStatus(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return true;
  return (ORDER_TRANSITIONS[currentStatus] || []).includes(nextStatus);
}

function canAccessOwnedOrder(req, order) {
  if (!order.userId) return true;
  if (!req.user) return false;
  return req.user.role === 'admin' || req.user.id === String(order.userId);
}

function canTrackOrder(req, order) {
  if (!req.user) return false;
  if (req.user.role === 'admin') return true;
  if (order.userId && req.user.id === String(order.userId)) return true;
  return req.user.role === 'delivery_partner' &&
    String(order.assignedPartnerId || '') === req.user.id;
}
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const Restaurant = require('./models/Restaurant');
const Order = require('./models/Order');
const User = require('./models/User');
const Review = require('./models/Review');
const RefreshSession = require('./models/RefreshSession');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  log('fatal', 'JWT_SECRET must be set and be at least 32 characters long');
  process.exit(1);
}
if (!process.env.MONGO_URI) {
  log('fatal', 'MONGO_URI is required');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' &&
    Boolean(process.env.RAZORPAY_KEY_ID) !== Boolean(process.env.RAZORPAY_KEY_SECRET)) {
  log('fatal', 'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must both be configured');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);

const apiMetrics = {
  requests: 0,
  errors: 0,
  paymentFailures: 0,
  statusConflicts: 0
};

function log(level, message, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...details
  };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = String(requestId);
  res.setHeader('X-Request-ID', req.requestId);

  apiMetrics.requests++;
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    if (res.statusCode >= 400) apiMetrics.errors++;
    if (res.statusCode === 409 && req.path.includes('/status')) apiMetrics.statusConflicts++;
    if (req.path.includes('/payments/') && res.statusCode >= 400) apiMetrics.paymentFailures++;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    log(res.statusCode >= 500 ? 'error' : 'info', 'http_request', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100
    });
  });
  next();
});

app.post(
  '/api/payments/razorpay/webhook',
  express.raw({ type: 'application/json', limit: '10kb' }),
  async (req, res) => {
    try {
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      if (!keySecret) return res.status(503).json({ error: 'Payment webhook is not configured' });

      const signature = String(req.headers['x-razorpay-signature'] || '');
      const expected = crypto.createHmac('sha256', keySecret).update(req.body).digest('hex');
      const sigBuf = Buffer.from(signature, 'utf8');
      const expBuf = Buffer.from(expected, 'utf8');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return res.status(400).json({ error: 'Invalid webhook signature' });
      }

      const event = JSON.parse(req.body.toString('utf8'));
      if (event.event === 'payment.captured') {
        const payment = event.payload?.payment?.entity;
        if (!payment?.order_id || !payment?.id) return res.status(400).json({ error: 'Invalid webhook payload' });

        const order = await Order.findOne({ razorpayOrderId: payment.order_id });
        if (!order) return res.status(404).json({ error: 'Order not found' });

        if (payment.amount !== Math.round(order.grandTotal * 100) ||
            payment.currency !== 'INR') {
          return res.status(400).json({ error: 'Payment amount or currency mismatch' });
        }

        const alreadyUsed = await Order.findOne({
          _id: { $ne: order._id },
          razorpayPaymentId: payment.id
        });
        if (alreadyUsed) return res.status(409).json({ error: 'Payment ID already used by another order' });

        order.razorpayPaymentId = payment.id;
        order.paymentStatus = 'PAID';
        order.paymentVerifiedAt = new Date();
        await order.save();
        broadcastOrderUpdate(order);
      }

      return res.json({ received: true });
    } catch (err) {
      return res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://checkout.razorpay.com"], scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
        imgSrc: ["'self'", "data:", "https://images.unsplash.com", "https://plus.unsplash.com", "https://*.razorpay.com"],
        frameSrc: ["'self'", "https://api.razorpay.com", "https://checkout.razorpay.com", "https://www.openstreetmap.org"],
        connectSrc: ["'self'", "https://api.razorpay.com", "https://lumberjack.razorpay.com"]
      }
    }
  })
);

app.use(express.json({ limit: '10kb' }));
app.use((req, res, next) => { if (req.body) mongoSanitize.sanitize(req.body); if (req.params) mongoSanitize.sanitize(req.params); if (req.query) mongoSanitize.sanitize(req.query); next(); });

app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ status: 'error', dependencies: { database: 'disconnected' } });
  }
  const paymentsConfigured = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  return res.status(200).json({
    status: 'ok',
    dependencies: {
      database: 'connected',
      payments: paymentsConfigured ? 'configured' : 'simulator'
    }
  });
});

app.get('/api/metrics', requireAuth, requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json(apiMetrics);
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'react', 'index.react.html'), (err) => {
    if (err) res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
});

app.use(express.static(path.join(__dirname, 'public')));

const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234';

function signUserToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );
}

const REFRESH_COOKIE = 'truehomes_refresh';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of String(header).split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function setRefreshCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${REFRESH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/api/auth; Max-Age=${Math.floor(REFRESH_TTL_MS / 1000)}; SameSite=Strict${secure}`
  );
}

function clearRefreshCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${REFRESH_COOKIE}=; HttpOnly; Path=/api/auth; Max-Age=0; SameSite=Strict${secure}`
  );
}

async function createRefreshSession(res, user) {
  const token = crypto.randomBytes(48).toString('base64url');
  await RefreshSession.create({
    userId: user._id,
    tokenHash: hashRefreshToken(token),
    familyId: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS)
  });
  setRefreshCookie(res, token);
  return token;
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = { id: payload.sub, role: payload.role, name: payload.name };
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
      req.user = { id: payload.sub, role: payload.role, name: payload.name };
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
  if (req.user.role === 'admin') return next();

  User.findById(req.user.id).select('isApproved').then((partner) => {
    if (!partner || !partner.isApproved) {
      return res.status(403).json({ error: 'Delivery partner account is awaiting admin approval' });
    }
    return next();
  }).catch((err) => {
    log('error', 'delivery_partner_approval_check_failed', {
      requestId: req.requestId,
      error: err.message
    });
    return res.status(500).json({ error: 'Could not verify delivery partner access' });
  });
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

function validateText(value, fieldName, minLength, maxLength) {
  if (typeof value !== 'string') return `${fieldName} is required`;
  const trimmed = value.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    return `${fieldName} must be between ${minLength} and ${maxLength} characters`;
  }
  return null;
}

function validateOrderPayload(body) {
  if (!body || typeof body !== 'object') return 'Invalid order payload';
  if (!mongoose.Types.ObjectId.isValid(body.restaurantId)) return 'Invalid restaurant ID';
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 50) {
    return 'Order must contain between 1 and 50 menu items';
  }

  for (const item of body.items) {
    if (!mongoose.Types.ObjectId.isValid(item?.menuItemId)) return 'One or more menu items are invalid';
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) return 'Menu item quantity must be between 1 and 20';
  }

  const nameError = validateText(body.customerName, 'Customer name', 2, 60);
  if (nameError) return nameError;

  if (typeof body.customerPhone !== 'string' ||
      !/^[0-9+\s-]{10,15}$/.test(body.customerPhone.trim())) {
    return 'Please enter a valid customer phone number';
  }

  const addressError = validateText(body.deliveryAddress, 'Delivery address', 5, 200);
  if (addressError) return addressError;

  if (body.paymentMethod !== undefined &&
      !['RAZORPAY', 'COD'].includes(body.paymentMethod)) {
    return 'Invalid payment method';
  }

  if (body.tip !== undefined && body.tip !== null &&
      (!Number.isFinite(Number(body.tip)) || Number(body.tip) < 0 || Number(body.tip) > 500)) {
    return 'Rider tip must be between ₹0 and ₹500';
  }

  return null;
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
      role: assignedRole,
      isApproved: assignedRole !== 'delivery_partner'
    });
    if (assignedRole === 'delivery_partner') {
      return res.status(202).json({
        pendingApproval: true,
        message: 'Delivery partner application submitted. Admin approval is required before sign in.',
        user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role }
      });
    }
    const token = signUserToken(user);
    await createRefreshSession(res, user);

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
    if (user.role === 'delivery_partner' && !user.isApproved) {
      return res.status(403).json({ error: 'Delivery partner account is awaiting admin approval' });
    }
    if (typeof req.body.role === 'string' &&
        ['customer', 'admin', 'delivery_partner'].includes(req.body.role) &&
        req.body.role !== user.role) {
      return res.status(403).json({ error: 'Account does not match the selected login type' });
    }

    const token = signUserToken(user);
    await createRefreshSession(res, user);
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
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (!password) {
      return res.status(401).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.role === 'delivery_partner' && !user.isApproved) {
      return res.status(403).json({ error: 'Delivery partner account is awaiting admin approval' });
    }

    const token = signUserToken(user);
    await createRefreshSession(res, user);
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

app.post('/api/auth/refresh', authLimiter, async (req, res) => {
  try {
    const token = parseCookies(req.headers.cookie)[REFRESH_COOKIE];
    if (!token) {
      return res.status(401).json({ error: 'Refresh session required' });
    }

    const tokenHash = hashRefreshToken(token);
    const session = await RefreshSession.findOne({ tokenHash });
    if (session && session.revokedAt) {
      await RefreshSession.updateMany({ familyId: session.familyId }, { revokedAt: new Date() });
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh session reuse detected' });
    }
    if (!session) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh session invalid or expired' });
    }
    if (session.expiresAt <= new Date()) {
      await RefreshSession.updateMany({ familyId: session.familyId }, { revokedAt: new Date() });
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh session invalid or expired' });
    }

    const user = await User.findById(session.userId);
    if (!user) {
      await RefreshSession.updateMany({ familyId: session.familyId }, { revokedAt: new Date() });
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Account unavailable' });
    }

    const revoked = await RefreshSession.updateOne(
      { _id: session._id, revokedAt: null },
      { revokedAt: new Date() }
    );
    if (revoked.modifiedCount !== 1) {
      await RefreshSession.updateMany({ familyId: session.familyId }, { revokedAt: new Date() });
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh session reuse detected' });
    }

    const nextToken = crypto.randomBytes(48).toString('base64url');
    await RefreshSession.create({
      userId: user._id,
      tokenHash: hashRefreshToken(nextToken),
      familyId: session.familyId,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS)
    });
    setRefreshCookie(res, nextToken);

    return res.json({
      token: signUserToken(user),
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not refresh session' });
  }
});

app.post('/api/auth/logout', optionalAuth, async (req, res) => {
  const token = parseCookies(req.headers.cookie)[REFRESH_COOKIE];
  if (token) {
    const session = await RefreshSession.findOne({ tokenHash: hashRefreshToken(token) });
    if (session) {
      await RefreshSession.updateMany({ familyId: session.familyId }, { revokedAt: new Date() });
    }
  }
  clearRefreshCookie(res);
  return res.json({ loggedOut: true });
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

// GET /api/restaurants/:id — fetch a single restaurant by ID
app.get('/api/restaurants/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid restaurant ID' });
    }
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    return res.json(restaurant);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch restaurant' });
  }
});

app.post('/api/orders', orderLimiter, optionalAuth, async (req, res) => {
  try {
    const { restaurantId, items, couponCode, tip = 0, paymentMethod, customerName, customerPhone, deliveryAddress } = req.body;

    const payloadError = validateOrderPayload(req.body);
    if (payloadError) return res.status(400).json({ error: payloadError });

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

    broadcastOrderUpdate(newOrder);
    return res.status(201).json(newOrder);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Could not place order' });
  }
});

app.post('/api/payments/razorpay/order', orderLimiter, optionalAuth, async (req, res) => {
  try {
    const { orderId, orderCode } = req.body;
    const order = mongoose.Types.ObjectId.isValid(orderId)
      ? await Order.findById(orderId)
      : await Order.findOne({ orderCode: String(orderCode || '').toUpperCase() });

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!canAccessOwnedOrder(req, order)) {
      return res.status(403).json({ error: 'You can only initiate payment for your own order' });
    }

    const amountPaise = Math.max(Math.round(order.grandTotal * 100), 100);
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'Payment processing is not configured' });
      }
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
    order.razorpayReceipt = rzpOrder.receipt || order.orderCode;
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

app.post('/api/payments/razorpay/verify', orderLimiter, optionalAuth, async (req, res) => {
  try {
    const { orderId, orderCode, razorpay_order_id, razorpay_payment_id, razorpay_signature, simulated } = req.body;

    const order = mongoose.Types.ObjectId.isValid(orderId)
      ? await Order.findById(orderId)
      : await Order.findOne({ orderCode: String(orderCode || '').toUpperCase() });

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!canAccessOwnedOrder(req, order)) {
      return res.status(403).json({ error: 'You can only verify your own payment' });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (keySecret && !simulated) {
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: 'Missing Razorpay payment signature fields' });
      }
      if (order.razorpayOrderId && order.razorpayOrderId !== razorpay_order_id) {
        return res.status(400).json({ error: 'Razorpay order ID mismatch' });
      }

      const alreadyUsed = await Order.findOne({
        _id: { $ne: order._id },
        razorpayPaymentId: razorpay_payment_id
      });
      if (alreadyUsed) {
        return res.status(409).json({ error: 'Payment ID already used by another order' });
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

      const keyId = process.env.RAZORPAY_KEY_ID;
      if (keyId) {
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const paymentRes = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(razorpay_payment_id)}`, {
          headers: { Authorization: `Basic ${auth}` }
        });
        const payment = await paymentRes.json();
        if (!paymentRes.ok) {
          return res.status(502).json({ error: 'Could not verify payment with Razorpay' });
        }
        if (payment.order_id !== razorpay_order_id ||
            payment.amount !== Math.round(order.grandTotal * 100) ||
            payment.currency !== 'INR') {
          return res.status(400).json({ error: 'Razorpay payment does not match this order' });
        }
      }

      order.razorpayOrderId = razorpay_order_id;
      order.razorpayPaymentId = razorpay_payment_id;
    } else if (!keySecret && simulated && process.env.NODE_ENV !== 'production') {
      order.razorpayPaymentId = 'pay_sim_' + crypto.randomBytes(4).toString('hex');
    } else {
      return res.status(400).json({ error: 'Payment verification rejected' });
    }

    order.paymentStatus = 'PAID';
    order.paymentVerifiedAt = new Date();
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

app.get('/api/orders/:orderCode', requireAuth, async (req, res) => {
  try {
    const code = String(req.params.orderCode).toUpperCase().replace(/[^A-Z0-9-]/g, '');
    const order = await Order.findOne({ orderCode: code }).lean();
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!canTrackOrder(req, order)) {
      return res.status(403).json({ error: 'You do not have access to this order' });
    }

    return res.json(order);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve order' });
  }
});

app.get('/api/orders/:orderCode/stream', requireAuth, async (req, res) => {
  try {
    const code = String(req.params.orderCode).toUpperCase().replace(/[^A-Z0-9-]/g, '');
    const order = await Order.findOne({ orderCode: code }).lean();
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!canTrackOrder(req, order)) {
      return res.status(403).json({ error: 'You do not have access to this order' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });

    res.write(`data: ${JSON.stringify(order)}\n\n`);

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

app.get('/api/admin/orders/stream', requireAuth, requireAdmin, async (req, res) => {
  let ready = false;
  let ping;
  const pendingUpdates = [];
  const send = (event) => {
    if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const onUpdate = (order) => {
    if (ready) send({ type: 'order', order });
    else pendingUpdates.push(order);
  };
  const cleanup = () => {
    clearInterval(ping);
    orderEvents.off('admin-orders', onUpdate);
  };

  orderEvents.on('admin-orders', onUpdate);
  res.once('close', cleanup);

  try {
    const orders = await Order.find().sort({ createdAt: -1 }).lean();
    if (res.destroyed) return cleanup();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    send({ type: 'snapshot', orders });
    ready = true;
    pendingUpdates.forEach((order) => send({ type: 'order', order }));

    ping = setInterval(() => {
      if (!res.destroyed) res.write(': ping\n\n');
    }, 20000);
  } catch (err) {
    cleanup();
    log('error', 'admin_order_stream_failed', {
      requestId: req.requestId,
      error: err.message
    });
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to open admin order stream' });
    }
    return res.end();
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

    const currentOrder = await Order.findById(req.params.id).select('status');
    if (!currentOrder) return res.status(404).json({ error: 'Order not found' });
    if (!canTransitionOrderStatus(currentOrder.status, status)) {
      return res.status(409).json({
        error: `Invalid status transition: ${currentOrder.status} -> ${status}`
      });
    }

    const update = { $set: { status } };
    if (status === 'DELIVERED') update.$unset = { deliveryLocation: 1 };
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, status: currentOrder.status },
      update,
      { new: true }
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });
    broadcastOrderUpdate(order);

    return res.json(order);
  } catch (err) {
    return res.status(400).json({ error: 'Failed to update order status' });
  }
});

app.get('/api/admin/delivery-partners/pending', requireAuth, requireAdmin, async (req, res) => {
  try {
    const partners = await User.find({
      role: 'delivery_partner',
      isApproved: { $ne: true }
    }).select('name email phone createdAt').sort({ createdAt: 1 }).lean();
    return res.json(partners);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load delivery partner applications' });
  }
});

app.patch('/api/admin/delivery-partners/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid delivery partner ID' });
    }
    const partner = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'delivery_partner' },
      { isApproved: true },
      { new: true }
    ).select('name email phone role isApproved');
    if (!partner) return res.status(404).json({ error: 'Delivery partner application not found' });
    return res.json(partner);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to approve delivery partner' });
  }
});

app.get('/api/delivery/orders', requireAuth, requireDeliveryPartner, async (req, res) => {
  try {
    const orders = await Order.find({
      $or: [
        { status: 'PREPARING', assignedPartnerId: null },
        { assignedPartnerId: req.user.id }
      ]
    }).sort({ createdAt: -1 }).limit(40);
    const visibleOrders = orders.map((order) => {
      const value = order.toObject();
      if (req.user.role !== 'admin' &&
          String(value.assignedPartnerId || '') !== String(req.user.id)) {
        delete value.customerName;
        delete value.customerPhone;
        delete value.deliveryAddress;
        delete value.userId;
      }
      return value;
    });
    return res.json(visibleOrders);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch delivery orders' });
  }
});

app.patch('/api/delivery/orders/:id/claim', requireAuth, requireDeliveryPartner, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    const partner = await User.findById(req.user.id);
    if (!partner) return res.status(404).json({ error: 'Delivery partner not found' });

    const currentOrder = await Order.findById(req.params.id);
    if (!currentOrder) return res.status(404).json({ error: 'Order not found' });
    if (currentOrder.status !== 'PREPARING') {
      return res.status(409).json({ error: 'Only orders being prepared can be claimed' });
    }
    if (currentOrder.assignedPartnerId &&
        currentOrder.assignedPartnerId.toString() !== req.user.id) {
      return res.status(409).json({ error: 'Order already claimed by another delivery partner' });
    }
    if (String(currentOrder.assignedPartnerId || '') === req.user.id) {
      return res.json(currentOrder);
    }

    const order = await Order.findOneAndUpdate(
      {
        _id: req.params.id,
        status: 'PREPARING',
        assignedPartnerId: null
      },
      {
        assignedPartnerId: req.user.id,
        assignedPartnerName: partner.name
      },
      { new: true }
    );
    if (!order) return res.status(409).json({ error: 'Order was claimed by another delivery partner' });

    broadcastOrderUpdate(order);

    return res.json(order);
  } catch (err) {
    return res.status(400).json({ error: 'Failed to claim delivery order' });
  }
});

app.patch('/api/delivery/orders/:id/location', requireAuth, requireDeliveryPartner, async (req, res) => {
  try {
    if (req.user.role !== 'delivery_partner') {
      return res.status(403).json({ error: 'Only assigned delivery partners can share GPS location' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }
    const { latitude, longitude } = req.body;
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) ||
        latitude < -90 || latitude > 90 ||
        typeof longitude !== 'number' || !Number.isFinite(longitude) ||
        longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: 'Latitude or longitude is invalid' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (String(order.assignedPartnerId) !== String(req.user.id)) {
      return res.status(403).json({ error: 'You must claim this order before sharing location' });
    }
    if (order.status !== 'OUT_FOR_DELIVERY') {
      return res.status(409).json({ error: 'GPS sharing is available only during an active delivery' });
    }

    order.deliveryLocation = { latitude, longitude, updatedAt: new Date() };
    await order.save();
    broadcastOrderUpdate(order);
    return res.json(order);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update delivery location' });
  }
});

app.delete('/api/delivery/orders/:id/location', requireAuth, requireDeliveryPartner, async (req, res) => {
  try {
    if (req.user.role !== 'delivery_partner') {
      return res.status(403).json({ error: 'Only assigned delivery partners can stop GPS sharing' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (String(order.assignedPartnerId) !== String(req.user.id)) {
      return res.status(403).json({ error: 'You must claim this order before managing location sharing' });
    }
    if (order.status !== 'OUT_FOR_DELIVERY') {
      return res.status(409).json({ error: 'GPS sharing is available only during an active delivery' });
    }

    order.deliveryLocation = undefined;
    await order.save();
    broadcastOrderUpdate(order);
    return res.json(order);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to stop delivery location sharing' });
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

    if (!canTransitionOrderStatus(order.status, status)) {
      return res.status(409).json({
        error: `Invalid status transition: ${order.status} -> ${status}`
      });
    }

    const update = { $set: { status } };
    if (status === 'DELIVERED') update.$unset = { deliveryLocation: 1 };
    const updatedOrder = await Order.findOneAndUpdate(
      { _id: req.params.id, status: order.status },
      update,
      { new: true }
    );
    if (!updatedOrder) {
      return res.status(409).json({ error: 'Order status changed concurrently. Please retry.' });
    }

    broadcastOrderUpdate(updatedOrder);

    return res.json(updatedOrder);
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

// ─── Review Routes ─────────────────────────────────────────────────────────────

// POST /api/orders/:orderCode/review  — submit a review for a DELIVERED order
app.post('/api/orders/:orderCode/review', requireAuth, async (req, res) => {
  try {
    const { orderCode } = req.params;
    const { foodRating, deliveryRating, comment } = req.body;

    // Validate foodRating
    const fr = Number(foodRating);
    if (!Number.isInteger(fr) || fr < 1 || fr > 5) {
      return res.status(400).json({ error: 'foodRating must be an integer 1-5' });
    }
    if (deliveryRating !== undefined && deliveryRating !== null) {
      const dr = Number(deliveryRating);
      if (!Number.isInteger(dr) || dr < 1 || dr > 5) {
        return res.status(400).json({ error: 'deliveryRating must be an integer 1-5' });
      }
    }

    // Fetch order
    const order = await Order.findOne({ orderCode });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Only the customer who placed the order may review (admin exempt for seeding)
    if (req.user.role !== 'admin') {
      const ownerId = order.userId ? String(order.userId) : null;
      if (!ownerId || ownerId !== String(req.user.id)) {
        return res.status(403).json({ error: 'You can only review your own orders' });
      }
    }

    if (order.status !== 'DELIVERED') {
      return res.status(400).json({ error: 'You can only review a delivered order' });
    }

    // Duplicate guard (unique index on orderId catches this too)
    const existing = await Review.findOne({ orderId: order._id });
    if (existing) return res.status(409).json({ error: 'You have already reviewed this order' });

    // Create review
    const review = await Review.create({
      orderId:        order._id,
      orderCode:      order.orderCode,
      userId:         req.user.id || null,
      restaurantId:   order.restaurantId,
      foodRating:     fr,
      deliveryRating: deliveryRating != null ? Number(deliveryRating) : null,
      comment:        typeof comment === 'string' ? comment.trim().slice(0, 300) : '',
      reviewerName:   req.user.name || 'Anonymous'
    });

    // Recalculate restaurant average rating
    const agg = await Review.aggregate([
      { $match: { restaurantId: order.restaurantId } },
      { $group: { _id: null, avg: { $avg: '$foodRating' }, count: { $sum: 1 } } }
    ]);
    if (agg.length > 0) {
      const newRating = Math.round(agg[0].avg * 10) / 10;
      await Restaurant.findByIdAndUpdate(order.restaurantId, {
        rating: newRating,
        reviewCount: agg[0].count
      });
    }

    return res.status(201).json(review);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'You have already reviewed this order' });
    return res.status(500).json({ error: err.message || 'Failed to submit review' });
  }
});

// GET /api/restaurants/:id/reviews  — public, last 10 reviews
app.get('/api/restaurants/:id/reviews', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid restaurant ID' });
    }
    const reviews = await Review.find({ restaurantId: req.params.id })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('foodRating deliveryRating comment reviewerName createdAt');
    return res.json(reviews);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

app.get('/legacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res) => {
  const reactIndex = path.join(__dirname, 'public', 'react', 'index.react.html');
  res.sendFile(reactIndex, (err) => {
    if (err) res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  const statusCode = err.statusCode || err.status || 500;
  if (statusCode >= 500) {
    log('error', 'unhandled_request_error', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      error: err.message
    });
  }

  return res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal server error' : err.message,
    requestId: req.requestId
  });
});

const PORT = Number(process.env.PORT) || 5000;
let server;

async function startServer() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    log('info', 'MongoDB connected');
    server = app.listen(PORT, () => {
      log('info', 'TrueHomes server started', { port: PORT });
    });
  } catch (err) {
    log('fatal', 'Database connection failed', { error: err.message });
    process.exit(1);
  }
}

async function shutdown(signal) {
  log('info', 'Shutdown initiated', { signal });
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await mongoose.disconnect();
  log('info', 'Shutdown complete');
  process.exit(0);
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled promise rejection', {
    error: reason instanceof Error ? reason.message : String(reason)
  });
});

startServer();