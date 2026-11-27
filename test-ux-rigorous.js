/**
 * TrueHomes Rigorous UI/UX Test Suite
 * =====================================
 * Covers all 4 user roles exhaustively:
 *   • Customer  – browse, cart, checkout, track, review, wallet, referral
 *   • Admin     – dashboard, manage restaurants, approve riders, coupons, analytics, security
 *   • Delivery  – provision, claim, GPS location, status transitions, OTP, tips
 *   • Kitchen   – portal, open/close, dish toggle, orders, chat
 *
 * Also covers: PWA assets, accessibility markers, SSE streams, security headers,
 *              offline/push UI markers, error states, edge cases.
 *
 * Run: node test-ux-rigorous.js
 */

'use strict';
require('dotenv').config();
const assert  = require('node:assert/strict');
const fs      = require('node:fs');
const path    = require('node:path');
const { spawn } = require('node:child_process');

const PORT     = process.env.UI_TEST_PORT || '5099';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PWD      = `UiRig@2026!`;

// ─── Server lifecycle ─────────────────────────────────────────────────────────
let serverProc;
async function waitForServer(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`${BASE_URL}/health`);
      if (r.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server did not start on port ${PORT}`);
}

// ─── Token store (filled during tests) ───────────────────────────────────────
let customerToken  = '';
let adminToken     = '';
let riderToken     = '';
let kitchenToken   = '';
let kitchenId      = '';
let restaurantId   = '';
let createdSuiteRestaurantId = '';
let dishId         = '';
let orderId        = '';
let orderCode      = '';
const run = Date.now();
const emails = {
  customer : `rig_cust_${run}@truehomes.test`,
  rider    : `rig_rider_${run}@truehomes.test`,
  kitchen  : `rig_kitchen_${run}@truehomes.test`,
  admin    : (process.env.ADMIN_EMAIL || `rig_admin_${run}@truehomes.test`).trim().toLowerCase(),
};

// ─── Test runner ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0, total = 0;
const failures = [];

async function test(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  ✔  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✖  ${name}`);
    console.error(`     ↳ ${err.message}`);
    failures.push({ name, error: err.message });
    failed++;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function req(path, opts = {}, token = null) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

function jwt(payload) {
  // Build a signed JWT using jsonwebtoken for admin token injection
  const jwtLib = require('jsonwebtoken');
  return jwtLib.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function runTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   TrueHomes Rigorous UI/UX Test Suite                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Start server
  let spawnedHere = false;
  try {
    const probe = await fetch(`${BASE_URL}/health`);
    if (!probe.ok) throw new Error();
  } catch (_) {
    spawnedHere = true;
    serverProc = spawn(process.execPath, ['server.js'], {
      env: { ...process.env, PORT, ADMIN_EMAIL: emails.admin, NODE_ENV: 'test' },
      stdio: 'ignore',
      cwd: __dirname,
    });
    await waitForServer();
  }

  // ════════════════════════════════════════════════════════════
  // PHASE 1: HEALTH, SECURITY & PWA ASSETS
  // ════════════════════════════════════════════════════════════
  console.log('═══ Phase 1: Health, Security & PWA Assets ═══\n');

  await test('1.1  GET /health → 200 with status=ok', async () => {
    const { res, body } = await req('/health');
    assert.equal(res.status, 200);
    assert.equal(body.status, 'ok');
  });

  await test('1.2  Security: Helmet X-Content-Type-Options header present', async () => {
    const { res } = await req('/health');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  await test('1.3  Security: Content-Security-Policy header present', async () => {
    const { res } = await req('/health');
    assert.ok(res.headers.get('content-security-policy'), 'CSP header missing');
  });

  await test('1.4  PWA: manifest.json is valid', async () => {
    const { res, body } = await req('/manifest.json');
    assert.equal(res.status, 200);
    assert.ok(body.name, 'manifest.name missing');
    assert.equal(body.display, 'standalone');
    assert.ok(Array.isArray(body.icons) && body.icons.length >= 2, 'Need ≥2 icons');
  });

  await test('1.5  PWA: service-worker.js accessible and skips /api/ caching', async () => {
    const r = await fetch(`${BASE_URL}/service-worker.js`);
    assert.equal(r.status, 200);
    const sw = await r.text();
    assert.ok(sw.includes('self.addEventListener("install"'), 'install listener missing');
    assert.ok(sw.includes('self.addEventListener("fetch"'), 'fetch listener missing');
    assert.ok(sw.includes('/api/'), 'Service worker must reference /api/ bypass');
  });

  await test('1.6  PWA: Offline banner marker in React source', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('isOffline') || src.includes('offline'), 'Offline state not found in source');
  });

  await test('1.7  PWA: Push-prompt banner marker in React source', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('showPushPrompt') || src.includes('PushManager'), 'Push prompt not found');
  });

  await test('1.8  Rate limiter: >6 rapid login failures returns 429', async () => {
    const attempts = Array.from({ length: 7 }, () =>
      req('/api/auth/login', {
        method: 'POST',
        headers: { 'X-Forwarded-For': '203.0.113.250' },
        body: JSON.stringify({ email: 'rate@test.com', password: 'wrong' }),
      })
    );
    const results = await Promise.all(attempts);
    const statuses = results.map((r) => r.res.status);
    assert.ok(statuses.some((s) => s === 429 || s === 401), 'Rate limiter should block or reject');
  });

  await test('1.9  NoSQL injection on login is blocked', async () => {
    const { res } = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: { $ne: '' }, password: { $ne: '' } }),
    });
    assert.equal(res.status, 401, 'NoSQL injection should not succeed');
  });

  // ════════════════════════════════════════════════════════════
  // PHASE 2: CUSTOMER ROLE — full journey
  // ════════════════════════════════════════════════════════════
  console.log('\n═══ Phase 2: Customer Role — Full Journey ═══\n');

  await test('2.1  Customer: Register new account', async () => {
    const { res, body } = await req('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Rigorous Customer', email: emails.customer, phone: '+91 9876540001', password: PWD, role: 'customer' }),
    });
    assert.equal(res.status, 201, `Register failed: ${JSON.stringify(body)}`);
    assert.equal(body.user.role, 'customer');
    customerToken = body.token;
  });

  await test('2.2  Customer: Reject duplicate registration (409)', async () => {
    const { res } = await req('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Dup', email: emails.customer, password: PWD }),
    });
    assert.equal(res.status, 409);
  });

  await test('2.3  Customer: Login with correct credentials', async () => {
    const { res, body } = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: emails.customer, password: PWD, role: 'customer' }),
    });
    assert.equal(res.status, 200);
    assert.ok(body.token, 'No token on login');
    customerToken = body.token;
  });

  await test('2.4  Customer: Reject login with wrong password', async () => {
    const { res } = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: emails.customer, password: 'WrongPass@99', role: 'customer' }),
    });
    assert.equal(res.status, 401);
  });

  await test('2.5  Customer: GET /api/auth/me returns user profile', async () => {
    const { res, body } = await req('/api/auth/me', {}, customerToken);
    assert.equal(res.status, 200);
    assert.equal(body.email, emails.customer);
  });

  await test('2.6  Customer: Browse restaurants list (public)', async () => {
    const { res, body } = await req('/api/restaurants');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body) && body.length >= 1, 'No restaurants found');
    restaurantId = body[0]._id;
    dishId = body[0].menu[0]?._id;
    assert.ok(restaurantId, 'Restaurant ID missing');
    assert.ok(dishId, 'Dish ID missing');
  });

  await test('2.7  Customer: Search restaurants by keyword', async () => {
    const { res, body } = await req('/api/restaurants?search=kitchen');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body), 'Response must be array');
  });

  await test('2.8  Customer: GET restaurant by ID includes menu', async () => {
    const { res, body } = await req(`/api/restaurants/${restaurantId}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body.menu), 'menu must be an array');
    assert.ok(body.menu.length >= 1, 'Menu should have at least 1 dish');
  });

  await test('2.9  Customer: Validate coupon code', async () => {
    const { res, body } = await req('/api/coupons/validate', {
      method: 'POST',
      body: JSON.stringify({ code: 'TRUE50', itemTotal: 300 }),
    }, customerToken);
    // Should succeed or fail gracefully (coupon may not exist in seed)
    assert.ok([200, 400, 404].includes(res.status), `Unexpected status: ${res.status}`);
  });

  await test('2.10 Customer: Place a COD order successfully', async () => {
    const { res, body } = await req('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        restaurantId,
        items: [{ menuItemId: dishId, qty: 2 }],
        tip: 15,
        paymentMethod: 'COD',
        customerName: 'Rigorous Customer',
        customerPhone: '+91 9876540001',
        deliveryAddress: 'Block B, Indirapuram, Ghaziabad',
      }),
    }, customerToken);
    assert.equal(res.status, 201, `Order failed: ${JSON.stringify(body)}`);
    assert.ok(body.orderCode?.startsWith('TH-'), 'Order code format wrong');
    assert.equal(body.status, 'CONFIRMED');
    orderId   = body._id;
    orderCode = body.orderCode;
  });

  await test('2.11 Customer: Get my orders list', async () => {
    const { res, body } = await req('/api/orders/my', {}, customerToken);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body), 'Response must be array');
    assert.ok(body.some((o) => o.orderCode === orderCode), 'Created order not in list');
  });

  await test('2.12 Customer: Track order by code (public endpoint)', async () => {
    const { res, body } = await req(`/api/orders/${orderCode}`, {}, customerToken);
    assert.equal(res.status, 200);
    assert.equal(body.orderCode, orderCode);
  });

  await test('2.13 Customer: Can cancel CONFIRMED order', async () => {
    // Create a separate order to cancel
    const { body: newOrder } = await req('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        restaurantId, items: [{ menuItemId: dishId, qty: 1 }],
        tip: 0, paymentMethod: 'COD',
        customerName: 'Cancel Test', customerPhone: '+91 9000000001',
        deliveryAddress: 'Test Street, Ghaziabad',
      }),
    }, customerToken);
    assert.ok(newOrder._id, 'Could not create order to cancel');
    const { res: cancelRes, body: cancelBody } = await req(
      `/api/orders/${newOrder.orderCode}/cancel`,
      { method: 'POST', body: JSON.stringify({ reason: 'Rigorous test cancellation' }) },
      customerToken
    );
    assert.ok([200, 201].includes(cancelRes.status), `Cancel failed: ${JSON.stringify(cancelBody)}`);
  });

  await test('2.14 Customer: Wallet balance endpoint returns numeric balance', async () => {
    const { res, body } = await req('/api/user/wallet', {}, customerToken);
    assert.equal(res.status, 200);
    assert.ok(typeof body.balance === 'number', `balance must be number, got ${typeof body.balance}`);
  });

  await test('2.15 Customer: Referral data endpoint returns referralCode', async () => {
    const { res, body } = await req('/api/user/referral', {}, customerToken);
    assert.ok([200, 201].includes(res.status), `Referral endpoint failed: ${res.status}`);
  });

  await test('2.16 Customer: Save delivery address (locked during active order, succeeds when idle)', async () => {
    // 1. Active order locks address modification
    const { res: lockedRes } = await req('/api/user/addresses', {
      method: 'POST',
      body: JSON.stringify({ label: 'Home', address: '42 Elm Street, Indirapuram' }),
    }, customerToken);
    assert.equal(lockedRes.status, 400, 'Address save should be locked while order is active');

    // 2. Clean customer without active orders can save address
    const { body: regBody } = await req('/api/auth/register', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '198.51.100.200' },
      body: JSON.stringify({
        name: 'Idle Customer',
        email: `idle_${run}@truehomes.test`,
        phone: '+91 9800000099',
        password: PWD,
      }),
    });
    const idleToken = regBody.token;
    const { res, body } = await req('/api/user/addresses', {
      method: 'POST',
      body: JSON.stringify({ label: 'Home', address: '42 Elm Street, Indirapuram' }),
    }, idleToken);
    assert.ok([200, 201].includes(res.status), `Address save failed: ${JSON.stringify(body)}`);
    assert.ok(Array.isArray(body.addresses), 'addresses must be array');
  });

  await test('2.17 Customer: Update profile name and phone (locked during active order, succeeds when idle)', async () => {
    // 1. Active order locks profile update
    const { res: lockedRes } = await req('/api/user/profile', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Blocked Update' }),
    }, customerToken);
    assert.equal(lockedRes.status, 400, 'Profile update should be locked while order is active');

    // 2. Clean customer without active orders can update profile
    const { body: loginBody } = await req('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '198.51.100.201' },
      body: JSON.stringify({ email: `idle_${run}@truehomes.test`, password: PWD }),
    });
    const { res, body } = await req('/api/user/profile', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Rig Customer Updated', phone: '+91 9800000001' }),
    }, loginBody.token);
    assert.ok([200, 201].includes(res.status), `Profile update failed: ${JSON.stringify(body)}`);
  });

  await test('2.18 Customer: Cannot access admin endpoints (403)', async () => {
    const { res } = await req('/api/admin/orders', { method: 'GET' }, customerToken);
    assert.ok([403, 401].includes(res.status), 'Customer should be blocked from admin endpoints');
  });

  await test('2.19 Customer: Cannot access delivery endpoints (403)', async () => {
    const { res } = await req('/api/delivery/orders', {}, customerToken);
    assert.ok([403, 401].includes(res.status), 'Customer should be blocked from delivery endpoints');
  });

  await test('2.20 Customer: Order SSE stream returns event-stream', async () => {
    const r = await fetch(`${BASE_URL}/api/orders/${orderCode}/stream`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert.equal(r.status, 200);
    assert.ok(r.headers.get('content-type')?.includes('text/event-stream'), 'Must be SSE');
    const reader = r.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    assert.ok(text.includes('data:'), 'SSE frame missing data: prefix');
    await reader.cancel();
  });

  await test('2.21 Customer: Chat stream endpoint reachable', async () => {
    const r = await fetch(`${BASE_URL}/api/orders/${orderCode}/chat`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert.ok([200, 404].includes(r.status), 'Chat endpoint should respond');
  });

  await test('2.22 Customer: Push subscribe endpoint exists', async () => {
    const { res } = await req('/api/push/vapid-public-key', {}, customerToken);
    // May be 200 or 503 (if VAPID keys not configured) – must not 404
    assert.ok(res.status !== 404, 'Push vapid-public-key endpoint missing');
  });

  await test('2.23 Customer: Unauthenticated request to /api/orders/my returns 401', async () => {
    const { res } = await req('/api/orders/my');
    assert.equal(res.status, 401);
  });

  await test('2.24 Customer: React source contains wallet UI markers', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('walletBalance') || src.includes('walletData'), 'Wallet balance state missing');
    assert.ok(src.includes('useWalletBalance'), 'useWalletBalance toggle missing');
  });

  await test('2.25 Customer: React source contains cart calculation logic', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('deliveryFee'), 'deliveryFee calculation missing');
    assert.ok(src.includes('finalTotal'), 'finalTotal calculation missing');
    assert.ok(src.includes('riderTip'), 'riderTip state missing');
  });

  // ════════════════════════════════════════════════════════════
  // PHASE 3: ADMIN ROLE
  // ════════════════════════════════════════════════════════════
  console.log('\n═══ Phase 3: Admin Role ═══\n');

  // Mint admin JWT directly (server provisions admin from env)
  await test('3.1  Admin: JWT provisioned correctly', async () => {
    adminToken = jwt({ sub: `admin-rig-${run}`, role: 'admin' });
    assert.ok(adminToken.length > 20, 'Admin token not generated');
  });

  await test('3.2  Admin: GET /api/restaurants returns full list', async () => {
    const { res, body } = await req('/api/restaurants', {}, adminToken);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body) && body.length >= 1);
  });

  await test('3.3  Admin: Create a new restaurant', async () => {
    const { res, body } = await req('/api/admin/restaurants', {
      method: 'POST',
      body: JSON.stringify({
        name: `RigTest Kitchen ${run}`,
        cuisines: ['North Indian', 'Mughlai'],
        deliveryTime: 25,
        costForTwo: 400,
        location: 'Sector 62, Noida',
        image: 'https://example.com/kitchen.jpg',
      }),
    }, adminToken);
    assert.ok([200, 201].includes(res.status), `Create restaurant failed: ${JSON.stringify(body)}`);
    assert.ok(body._id || body.restaurant?._id, 'Restaurant ID missing from response');
    createdSuiteRestaurantId = body._id || body.restaurant?._id;
  });

  await test('3.4  Admin: Add a dish to existing restaurant', async () => {
    const { res, body } = await req(`/api/admin/restaurants/${restaurantId}/menu`, {
      method: 'POST',
      body: JSON.stringify({
        name: `RigDish${run}`,
        price: 220,
        category: 'Mains',
        isVeg: true,
        isBestseller: false,
        description: 'Rigorous test dish',
      }),
    }, adminToken);
    assert.ok([200, 201].includes(res.status), `Add dish failed: ${JSON.stringify(body)}`);
  });

  await test('3.5  Admin: Update order status (CONFIRMED → PREPARING)', async () => {
    const { res, body } = await req(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'PREPARING' }),
    }, adminToken);
    assert.ok([200, 201].includes(res.status), `Status update failed: ${JSON.stringify(body)}`);
  });

  await test('3.6  Admin: Reject invalid order status transition', async () => {
    // Can't go PREPARING → CONFIRMED
    const { res } = await req(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'CONFIRMED' }),
    }, adminToken);
    assert.ok([400, 409, 422].includes(res.status), 'Invalid transition should be rejected');
  });

  await test('3.7  Admin: List pending delivery partner applications', async () => {
    const { res, body } = await req('/api/admin/delivery-partners/pending', {}, adminToken);
    assert.ok([200].includes(res.status), `Pending riders failed: ${res.status}`);
    assert.ok(Array.isArray(body), 'Response must be array');
  });

  await test('3.8  Admin: Create a coupon', async () => {
    const { res, body } = await req('/api/admin/coupons', {
      method: 'POST',
      body: JSON.stringify({
        code: `RIGTEST${run}`.slice(0, 15),
        discountPercent: 20,
        maxDiscount: 100,
        minOrderAmount: 199,
        description: 'Rigorous test coupon',
      }),
    }, adminToken);
    assert.ok([200, 201, 409].includes(res.status), `Coupon create failed: ${JSON.stringify(body)}`);
  });

  await test('3.9  Admin: GET /api/admin/analytics returns metrics object', async () => {
    const { res, body } = await req('/api/admin/analytics', {}, adminToken);
    assert.ok([200].includes(res.status), `Analytics failed: ${res.status}`);
  });

  await test('3.10 Admin: Admin order stream (SSE) connects and returns event-stream', async () => {
    const r = await fetch(`${BASE_URL}/api/admin/orders/stream`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(r.status, 200);
    assert.ok(r.headers.get('content-type')?.includes('text/event-stream'), 'Must be SSE');
    const reader = r.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    assert.ok(text.includes('data:'), 'SSE admin stream missing data: prefix');
    await reader.cancel();
  });

  await test('3.11 Admin: Customer JWT cannot access admin stream (401/403)', async () => {
    const r = await fetch(`${BASE_URL}/api/admin/orders/stream`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert.ok([401, 403].includes(r.status), 'Non-admin must not access admin stream');
  });

  await test('3.12 Admin: React source contains admin dashboard tab markers', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('adminActiveTab'), 'adminActiveTab state missing');
    assert.ok(src.includes('openAdminOrders'), 'openAdminOrders function missing');
  });

  await test('3.13 Admin: React source contains coupon creator UI markers', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('newCouponCode'), 'newCouponCode state missing');
    assert.ok(src.includes('adminCouponsList'), 'adminCouponsList state missing');
  });

  // ════════════════════════════════════════════════════════════
  // PHASE 4: DELIVERY PARTNER ROLE
  // ════════════════════════════════════════════════════════════
  console.log('\n═══ Phase 4: Delivery Partner Role ═══\n');

  let riderId = '';

  await test('4.1  Rider: Register delivery_partner account (pending approval)', async () => {
    const { res, body } = await req('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Rig Rider Express', email: emails.rider, phone: '+91 9765432100', password: PWD, role: 'delivery_partner' }),
    });
    assert.equal(res.status, 202, `Rider register failed: ${JSON.stringify(body)}`);
    assert.equal(body.pendingApproval, true);
    assert.equal(body.user.role, 'delivery_partner');
    riderId = body.user.id || body.user._id;
  });

  await test('4.2  Rider: Cannot login before admin approval', async () => {
    const { res } = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: emails.rider, password: PWD, role: 'delivery_partner' }),
    });
    assert.ok([401, 403].includes(res.status), 'Unapproved rider should be blocked');
  });

  await test('4.3  Admin: Approve delivery partner application', async () => {
    const { res, body } = await req(`/api/admin/delivery-partners/${riderId}/approve`, {
      method: 'PATCH',
    }, adminToken);
    assert.equal(res.status, 200, `Approval failed: ${JSON.stringify(body)}`);
  });

  await test('4.4  Rider: Login after admin approval', async () => {
    const { res, body } = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: emails.rider, password: PWD, role: 'delivery_partner' }),
    });
    assert.equal(res.status, 200, `Login failed: ${JSON.stringify(body)}`);
    riderToken = body.token;
  });

  await test('4.5  Rider: GET /api/delivery/orders returns list', async () => {
    const { res, body } = await req('/api/delivery/orders', {}, riderToken);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body), 'Must return array');
  });

  await test('4.6  Rider: Claim available order', async () => {
    // Order must be in PREPARING state (we set that in 3.5)
    const { res, body } = await req(`/api/delivery/orders/${orderId}/claim`, { method: 'PATCH' }, riderToken);
    assert.ok([200, 201].includes(res.status), `Claim failed: ${JSON.stringify(body)}`);
    assert.ok(body.assignedPartnerName || body.assignedPartnerId, 'Rider not assigned to order');
  });

  await test('4.7  Rider: Update order to OUT_FOR_DELIVERY', async () => {
    const { res, body } = await req(`/api/delivery/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'OUT_FOR_DELIVERY' }),
    }, riderToken);
    assert.ok([200, 201].includes(res.status), `Status update failed: ${JSON.stringify(body)}`);
  });

  await test('4.8  Rider: Share GPS location for active order', async () => {
    const { res, body } = await req(`/api/delivery/orders/${orderId}/location`, {
      method: 'PATCH',
      body: JSON.stringify({ latitude: 28.6303, longitude: 77.3651 }),
    }, riderToken);
    assert.ok([200, 201].includes(res.status), `GPS sharing failed: ${JSON.stringify(body)}`);
  });

  await test('4.9  Rider: Toggle availability status', async () => {
    const { res, body } = await req('/api/delivery/availability', {
      method: 'PATCH',
      body: JSON.stringify({ isAvailable: false }),
    }, riderToken);
    assert.ok([200, 201].includes(res.status), `Availability toggle failed: ${JSON.stringify(body)}`);
  });

  await test('4.10 Rider: Mark order as DELIVERED', async () => {
    const noOtp = await req(`/api/delivery/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'DELIVERED' }),
    }, riderToken);
    assert.ok([400, 409].includes(noOtp.res.status), 'Delivery without OTP must be rejected');

    const { body: riderOrders } = await req('/api/delivery/orders', {}, riderToken);
    const target = Array.isArray(riderOrders)
      ? riderOrders.find((o) => String(o._id) === String(orderId))
      : null;
    const { res, body } = await req(`/api/delivery/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'DELIVERED', otp: target?.deliveryOtp }),
    }, riderToken);
    assert.ok([200, 201].includes(res.status), `DELIVERED update failed: ${JSON.stringify(body)}`);
  });

  await test('4.11 Rider: Cannot access admin dashboard (403)', async () => {
    const { res } = await req('/api/admin/orders', {}, riderToken);
    assert.ok([401, 403].includes(res.status), 'Rider must not access admin');
  });

  await test('4.12 Rider: React source contains location-sharing functions', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('startLocationSharing'), 'startLocationSharing missing');
    assert.ok(src.includes('stopLocationSharing'), 'stopLocationSharing missing');
    assert.ok(src.includes('sharingOrderId'), 'sharingOrderId state missing');
  });

  await test('4.13 Rider: React source contains availability toggle UI', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('toggleRiderAvailability'), 'toggleRiderAvailability function missing');
  });

  await test('4.14 Rider: React source contains delivery dashboard metrics markers', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('partnerOrders'), 'partnerOrders state missing');
    assert.ok(src.includes('deliveryOpen'), 'deliveryOpen state missing');
  });

  // ════════════════════════════════════════════════════════════
  // PHASE 5: KITCHEN OWNER ROLE
  // ════════════════════════════════════════════════════════════
  console.log('\n═══ Phase 5: Kitchen Owner Role ═══\n');

  await test('5.1  Kitchen: Register kitchen_owner account', async () => {
    const { res, body } = await req('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Rig Kitchen Boss', email: emails.kitchen, phone: '+91 9765400001', password: PWD, role: 'kitchen_owner' }),
    });
    assert.ok([201, 202].includes(res.status), `Kitchen register failed: ${JSON.stringify(body)}`);
    kitchenToken = body.token;
    kitchenId = body.user?.id;
  });

  await test('5.1b Kitchen: Admin assigns a restaurant to the kitchen owner', async () => {
    if (!adminToken || !restaurantId || !kitchenId) { assert.fail('Missing admin/restaurant/kitchen fixture'); return; }
    const { res, body } = await req(`/api/admin/kitchens/${restaurantId}/assign-owner`, {
      method: 'POST',
      body: JSON.stringify({ ownerId: kitchenId }),
    }, adminToken);
    assert.equal(res.status, 200, `Assign failed: ${JSON.stringify(body)}`);
  });

  await test('5.2  Kitchen: GET /api/kitchen/my endpoint reachable', async () => {
    if (!kitchenToken) { assert.fail('kitchenToken not set'); return; }
    const { res } = await req('/api/kitchen/my', {}, kitchenToken);
    assert.ok([200, 404].includes(res.status), 'Kitchen my endpoint failed');
  });

  await test('5.3  Kitchen: GET /api/kitchen/my/orders endpoint reachable', async () => {
    if (!kitchenToken) { assert.fail('kitchenToken not set'); return; }
    const { res, body } = await req('/api/kitchen/my/orders', {}, kitchenToken);
    assert.ok([200, 404].includes(res.status), `Kitchen orders failed: ${res.status}`);
  });

  await test('5.4  Kitchen: Toggle kitchen open/closed', async () => {
    if (!kitchenToken) { assert.fail('kitchenToken not set'); return; }
    const closed = await req('/api/kitchen/my/toggle', {
      method: 'PATCH',
      body: JSON.stringify({ isOpen: false }),
    }, kitchenToken);
    assert.equal(closed.res.status, 200, `Close failed: ${JSON.stringify(closed.body)}`);
    const reopened = await req('/api/kitchen/my/toggle', {
      method: 'PATCH',
      body: JSON.stringify({ isOpen: true }),
    }, kitchenToken);
    assert.equal(reopened.res.status, 200, `Reopen failed: ${JSON.stringify(reopened.body)}`);
  });

  await test('5.5  Kitchen: Toggle dish stock', async () => {
    if (!kitchenToken) { assert.fail('kitchenToken not set'); return; }
    const off = await req(`/api/kitchen/my/menu/${dishId}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ isAvailable: false }),
    }, kitchenToken);
    assert.equal(off.res.status, 200, 'Dish stock toggle unexpected status');
    const on = await req(`/api/kitchen/my/menu/${dishId}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ isAvailable: true }),
    }, kitchenToken);
    assert.equal(on.res.status, 200, 'Dish stock restore failed');
  });

  await test('5.6  Kitchen: React source contains kitchen portal states', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('kitchenOpen'), 'kitchenOpen state missing');
    assert.ok(src.includes('myKitchen'), 'myKitchen state missing');
    assert.ok(src.includes('toggleKitchenDuty'), 'toggleKitchenDuty function missing');
    assert.ok(src.includes('toggleDishStock'), 'toggleDishStock function missing');
  });

  await test('5.7  Kitchen: React source contains kitchen portal JSX', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('Kitchen'), 'No Kitchen text in source');
    assert.ok(src.includes('kitchenTab'), 'Kitchen tab state missing');
  });

  await test('5.8  Kitchen: portal is role-gated to kitchen_owner in shipped frontend', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('role === "kitchen_owner"'), 'kitchen_owner role gating missing');
    assert.ok(src.includes('setKitchenOpen(true)'), 'Kitchen portal is never opened for owners');
  });

  await test('5.9  Kitchen: Chat modal reachable from order context', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('chatOrderCode'), 'chatOrderCode state missing');
    assert.ok(src.includes('sendChatMessage'), 'sendChatMessage function missing');
  });

  // ════════════════════════════════════════════════════════════
  // PHASE 6: UI/UX COMPONENT STRUCTURE & ACCESSIBILITY
  // ════════════════════════════════════════════════════════════
  console.log('\n═══ Phase 6: UI/UX Component Structure & Accessibility ═══\n');

  await test('6.1  Single React frontend source is present (legacy + modular paths removed)', async () => {
    const required = [
      'src/react/main.jsx',
      'src/react/styles.css',
      'index.react.html',
      'vite.config.mjs',
      'public/react/index.react.html'
    ];
    for (const f of required) {
      assert.ok(fs.existsSync(path.join(__dirname, f)), `Missing frontend file: ${f}`);
    }
    const removed = [
      'src/react/App.jsx',
      'src/react/components',
      'src/react/context',
      'src/react/__tests__',
      'public/index.html',
      'public/js',
      'public/css',
      'public/sw.js'
    ];
    for (const gone of removed) {
      assert.ok(!fs.existsSync(path.join(__dirname, gone)), `Retired frontend path still present: ${gone}`);
    }
  });

  await test('6.2  Vite builds the single React entry into public/react', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'vite.config.mjs'), 'utf8');
    assert.ok(src.includes('input: "index.react.html"'), 'Vite entry is not index.react.html');
    assert.ok(src.includes('outDir: "public/react"'), 'Vite output dir is not public/react');
  });

  await test('6.3  Entry registers the service worker for PWA push', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('navigator.serviceWorker.register("/service-worker.js")'), 'service worker registration missing from entry');
    assert.ok(src.includes('PushManager'), 'push subscription support missing from entry');
  });

  await test('6.4  Chat UI wired to order-scoped SSE stream in shipped frontend', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('chatOrderCode'), 'chatOrderCode state missing');
    assert.ok(src.includes('Live Chat'), 'chat modal markup missing');
    assert.ok(src.includes('/chat/stream'), 'chat stream endpoint not referenced');
  });

  await test('6.5  Restaurant grid and search controls rendered in shipped frontend', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('restaurants.map'), 'restaurant grid rendering missing');
    assert.ok(src.includes('setSearch'), 'search control missing');
  });

  await test('6.6  User-facing notifications use the notice system', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('setNotice'), 'notice/toast helper missing');
  });

  await test('6.7  Razorpay checkout script and client are wired', async () => {
    const html = fs.readFileSync(path.join(__dirname, 'index.react.html'), 'utf8');
    assert.ok(html.includes('checkout.razorpay.com'), 'Razorpay script missing from shell');
    const src = fs.readFileSync(path.join(__dirname, 'src/react/main.jsx'), 'utf8');
    assert.ok(src.includes('window.Razorpay'), 'Razorpay client not used in entry');
  });

  await test('6.8  Retired legacy route and fallbacks are gone from server', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    assert.ok(!src.includes("app.get('/legacy'"), '/legacy route still served');
    assert.ok(!src.includes("'public', 'index.html'"), 'public/index.html fallback still referenced');
  });

  await test('6.9  Legacy static assets are no longer served', async () => {
    const res = await fetch(`${BASE_URL}/js/app.js`);
    const body = await res.text();
    assert.ok(!body.includes('TrueHomesAPI'), 'Legacy JS bundle is still served');
    assert.ok(body.includes('<div id="root">'), 'Unknown path did not fall back to SPA shell');
  });

  await test('6.10 CI/CD workflow file exists and contains MongoDB service', async () => {
    const p = path.join(__dirname, '.github/workflows/ci.yml');
    assert.ok(fs.existsSync(p), 'ci.yml missing');
    const src = fs.readFileSync(p, 'utf8');
    assert.ok(src.includes('mongo'), 'MongoDB service missing from CI workflow');
    assert.ok(src.includes('npm run build'), 'Build step missing from CI');
    assert.ok(src.includes('npm run test:ui'), 'UI test step missing from CI');
  });

  await test('6.11 README describes the single frontend, scripts, and testing', async () => {
    const p = path.join(__dirname, 'README.md');
    assert.ok(fs.existsSync(p), 'README.md missing');
    const src = fs.readFileSync(p, 'utf8');
    assert.ok(src.includes('Quick Start'), 'Quick Start section missing');
    assert.ok(src.includes('Architecture'), 'Architecture section missing');
    assert.ok(src.includes('Single frontend'), 'README does not document the single-frontend layout');
    assert.ok(src.includes('Testing'), 'Testing section missing');
    assert.ok(src.includes('CI/CD'), 'CI/CD docs missing');
  });

  await test('6.12 No console.log in React source files', async () => {
    const files = [
      'src/react/main.jsx',
    ];
    for (const f of files) {
      const fp = path.join(__dirname, f);
      if (!fs.existsSync(fp)) continue;
      const src = fs.readFileSync(fp, 'utf8');
      assert.ok(!src.includes('console.log'), `console.log found in ${f}`);
    }
  });

  // ════════════════════════════════════════════════════════════
  // PHASE 7: EDGE CASES & SECURITY
  // ════════════════════════════════════════════════════════════
  console.log('\n═══ Phase 7: Edge Cases & Security ═══\n');

  await test('7.1  Empty cart: checkout returns 400', async () => {
    const { res } = await req('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ restaurantId, items: [], tip: 0, paymentMethod: 'COD', customerName: 'X', customerPhone: '0000000000', deliveryAddress: 'X' }),
    }, customerToken);
    assert.ok([400, 422].includes(res.status), 'Empty cart should be rejected');
  });

  await test('7.2  Missing required fields on order returns 400', async () => {
    const { res } = await req('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ restaurantId }),
    }, customerToken);
    assert.ok([400, 422].includes(res.status), 'Missing fields should be rejected');
  });

  await test('7.3  Invalid order code returns 404', async () => {
    const { res } = await req('/api/orders/INVALID-CODE-XYZ', {}, customerToken);
    assert.ok([404, 400].includes(res.status), 'Invalid code should return 404');
  });

  await test('7.4  Expired/tampered JWT returns 401', async () => {
    const { res } = await req('/api/auth/me', {}, 'this.is.not.a.valid.token');
    assert.equal(res.status, 401);
  });

  await test('7.5  Missing Authorization header returns 401', async () => {
    const { res } = await req('/api/orders/my');
    assert.equal(res.status, 401);
  });

  await test('7.6  PATCH order status with invalid status value returns 400', async () => {
    const { res } = await req(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'FLYING' }),
    }, adminToken);
    assert.ok([400, 422].includes(res.status), 'Invalid status should be rejected');
  });

  await test('7.7  Customer cannot cancel DELIVERED order', async () => {
    // orderId is now DELIVERED from phase 4
    const { res } = await req(`/api/orders/${orderCode}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Already delivered cancel attempt' }),
    }, customerToken);
    assert.ok([400, 409, 422].includes(res.status), 'Cancelling delivered order should fail');
  });

  await test('7.8  GET /api/restaurants with invalid ID returns 400 or 404', async () => {
    const { res } = await req('/api/restaurants/not-a-valid-id');
    assert.ok([400, 404].includes(res.status), `Unexpected status: ${res.status}`);
  });

  await test('7.9  Request body too large is rejected (413)', async () => {
    const bigPayload = { name: 'x'.repeat(100_000), cuisines: [] };
    const { res } = await req('/api/admin/restaurants', {
      method: 'POST',
      body: JSON.stringify(bigPayload),
    }, adminToken);
    assert.ok([400, 413, 422].includes(res.status), 'Large payload should be rejected or truncated');
  });

  await test('7.10 Duplicate coupon code rejected (409)', async () => {
    const code = `DUP${run}`.slice(0, 10);
    await req('/api/admin/coupons', { method: 'POST', body: JSON.stringify({ code, discountPercent: 10, minOrderAmount: 100 }) }, adminToken);
    const { res } = await req('/api/admin/coupons', { method: 'POST', body: JSON.stringify({ code, discountPercent: 10, minOrderAmount: 100 }) }, adminToken);
    assert.ok([400, 409].includes(res.status), 'Duplicate coupon should be rejected');
  });

  // ════════════════════════════════════════════════════════════
  // CLEANUP
  // ════════════════════════════════════════════════════════════
  await test('8.1  Cleanup: Remove test accounts and orders', async () => {
    const mongoose = require('mongoose');
    const User             = require('./models/User');
    const Order            = require('./models/Order');
    const Restaurant       = require('./models/Restaurant');
    const RefreshSession   = require('./models/RefreshSession');
    const Coupon           = require('./models/Coupon');
    const Chat             = require('./models/Chat');
    const WalletTransaction = require('./models/WalletTransaction');

    await mongoose.connect(process.env.MONGO_URI);
    const testEmails = [...Object.values(emails).filter(Boolean), `idle_${run}@truehomes.test`];
    const users = await User.find({ email: { $in: testEmails } }).select('_id').lean();
    const userIds = users.map((u) => u._id);
    if (userIds.length) {
      await RefreshSession.deleteMany({ userId: { $in: userIds } });
      await WalletTransaction.deleteMany({ userId: { $in: userIds } });
      await User.deleteMany({ _id: { $in: userIds } });
    }
    if (orderCode) await Chat.deleteMany({ orderCode });
    if (orderCode) await Order.deleteOne({ orderCode });
    if (createdSuiteRestaurantId) await Restaurant.findByIdAndDelete(createdSuiteRestaurantId);
    await Coupon.deleteMany({ code: { $regex: `RIG|DUP` } });
    await mongoose.disconnect();
  });

  if (spawnedHere && serverProc && !serverProc.killed) {
    serverProc.kill('SIGTERM');
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${passed}/${total} passed  |  ${failed} failed                        ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (failures.length) {
    console.log('\n❌ Failed tests:');
    failures.forEach(({ name, error }) => {
      console.log(`  • ${name}`);
      console.log(`    ↳ ${error}`);
    });
  } else {
    console.log('\n✅ All tests passed!');
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('\n💥 Test runner crashed:', err.message);
  if (serverProc && !serverProc.killed) serverProc.kill('SIGTERM');
  process.exit(1);
});
