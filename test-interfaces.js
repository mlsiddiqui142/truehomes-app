require('dotenv').config();
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const PORT = process.env.UI_TEST_PORT || '5066';
const BASE_URL = `http://127.0.0.1:${PORT}`;
let serverProc;

async function waitForServer(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server failed to start on port ${PORT} within timeout`);
}

async function runInterfaceTests() {
  console.log('====================================================');
  console.log('🚀 TrueHomes Automated Interface & UI Verification Suite');
  console.log('====================================================\n');

  // Check if server is already reachable on BASE_URL; if not, spawn it automatically
  let spawnedHere = false;
  try {
    const probe = await fetch(`${BASE_URL}/health`);
    if (!probe.ok) throw new Error('Not ready');
  } catch (_) {
    spawnedHere = true;
    serverProc = spawn(process.execPath, ['server.js'], {
      env: { ...process.env, PORT, NODE_ENV: 'test' },
      stdio: 'ignore'
    });
    await waitForServer();
  }

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✔ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✖ [FAIL] ${name}`);
      console.error(`     Error: ${err.message}\n`);
    }
  }

  // 1. PWA & Shell Interface
  console.log('📌 Phase 1: Static Shell & PWA Assets Interface');
  await test('1.1 Root URL serves the React SPA shell', async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<!doctype html>'));
    assert.ok(html.includes('<title>TrueHomes'));
    assert.ok(html.includes('cdn.tailwindcss.com'));
    assert.ok(html.includes('checkout.razorpay.com'));
    assert.ok(html.includes('<div id="root">'));
    assert.ok(/\/react\/assets\/[^"]+\.js/.test(html), 'JS bundle reference missing from shell');
  });

  await test('1.2 PWA Web App Manifest is valid and reachable', async () => {
    const res = await fetch(`${BASE_URL}/manifest.json`);
    assert.equal(res.status, 200);
    const manifest = await res.json();
    assert.equal(manifest.name, 'TrueHomes — Homestyle & Top Rated Food Delivery');
    assert.equal(manifest.short_name, 'TrueHomes');
    assert.equal(manifest.display, 'standalone');
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
  });

  await test('1.3 PWA Service Worker is syntactically sound and accessible', async () => {
    const res = await fetch(`${BASE_URL}/service-worker.js`);
    assert.equal(res.status, 200);
    const sw = await res.text();
    assert.ok(sw.includes('self.addEventListener("install"'));
    assert.ok(sw.includes('self.addEventListener("fetch"'));
    assert.ok(sw.includes('url.pathname.startsWith("/api/")'));
  });

  await test('1.4 Built JS bundle and stylesheet are reachable and ship the service worker registration', async () => {
    const html = await (await fetch(`${BASE_URL}/`)).text();
    const assetUrls = [...html.matchAll(/(?:src|href)="(\/react\/assets\/[^"]+)"/g)].map((m) => m[1]);
    const jsUrl = assetUrls.find((url) => url.endsWith('.js'));
    const cssUrl = assetUrls.find((url) => url.endsWith('.css'));
    assert.ok(jsUrl, 'No JS bundle referenced in shell');
    assert.ok(cssUrl, 'No CSS bundle referenced in shell');

    const jsRes = await fetch(`${BASE_URL}${jsUrl}`);
    assert.equal(jsRes.status, 200);
    const bundle = await jsRes.text();
    assert.ok(bundle.length > 1000, 'JS bundle appears empty');
    assert.ok(bundle.includes('serviceWorker'), 'Bundle does not register a service worker');

    const cssRes = await fetch(`${BASE_URL}${cssUrl}`);
    assert.equal(cssRes.status, 200);
    assert.ok((await cssRes.text()).length > 1000, 'CSS bundle appears empty');
  });

  // 2. SPA Routing
  console.log('\n📌 Phase 2: SPA Routing Interface');
  await test('2.1 Unknown client route falls back to the SPA shell', async () => {
    const res = await fetch(`${BASE_URL}/restaurants/some-deep-link`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<div id="root">'), 'SPA fallback did not return the app shell');
  });

  await test('2.2 Retired legacy entry point is gone', async () => {
    const res = await fetch(`${BASE_URL}/legacy`);
    const html = await res.text();
    assert.ok(!html.includes('id="authModal"'), 'Legacy vanilla UI should no longer be served');
    assert.ok(html.includes('<div id="root">'), 'Retired route should fall back to the SPA shell');
  });

  // 3. Client Calculation Engine
  console.log('\n📌 Phase 3: Client-Side Business Logic & Cart Calculation Engine');
  await test('3.1 Cart pricing logic computes subtotal, threshold delivery fee, discount & tip correctly', async () => {
    function calculateBill(itemTotal, couponCode, tip) {
      let discount = 0;
      let deliveryFee = itemTotal >= 299 ? 0 : 35;
      if (couponCode === 'TRUE50' && itemTotal >= 199) {
        discount = Math.min(Math.round(itemTotal * 0.5), 100);
      } else if (couponCode === 'FREEDEL') {
        deliveryFee = 0;
      }
      const tax = Math.round((itemTotal - discount) * 0.05);
      const grandTotal = itemTotal - discount + deliveryFee + tax + tip;
      return { itemTotal, discount, deliveryFee, tax, tip, grandTotal };
    }

    // Case A: Cart under ₹299 (pays ₹35 delivery)
    const bill1 = calculateBill(200, 'NONE', 0);
    assert.equal(bill1.deliveryFee, 35);
    assert.equal(bill1.discount, 0);
    assert.equal(bill1.tax, 10);
    assert.equal(bill1.grandTotal, 245);

    // Case B: Cart >= ₹299 (free delivery)
    const bill2 = calculateBill(350, 'NONE', 0);
    assert.equal(bill2.deliveryFee, 0);
    assert.equal(bill2.tax, 18);
    assert.equal(bill2.grandTotal, 368);

    // Case C: Promo TRUE50 with rider tip
    const bill3 = calculateBill(500, 'TRUE50', 30);
    assert.equal(bill3.discount, 100); // Capped at ₹100
    assert.equal(bill3.deliveryFee, 0);
    assert.equal(bill3.tax, 20); // (500 - 100) * 0.05
    assert.equal(bill3.grandTotal, 450); // 400 + 20 + 30
  });

  // 4. Live UI Endpoints & Role Workflows
  console.log('\n📌 Phase 4: Live End-to-End User Interface Workflows');
  let customerToken = '';
  let riderToken = '';
  let adminToken = '';
  let createdOrderId = '';
  let createdOrderCode = '';
  let createdOrderOtp = '';
  const testRun = Date.now();
  const uiCustomerEmail = `ui_cust_${testRun}@truehomes.test`;
  const uiRiderEmail = `ui_rider_${testRun}@truehomes.test`;
  let reviewTestEmail = '';
  let reviewTestOrderCode = '';

  await test('4.1 Customer Interface: Fetch restaurants and verify cuisine data', async () => {
    const res = await fetch(`${BASE_URL}/api/restaurants`);
    assert.equal(res.status, 200);
    const kitchens = await res.json();
    assert.ok(Array.isArray(kitchens) && kitchens.length >= 1);
    const first = kitchens[0];
    assert.ok(first.name);
    assert.ok(Array.isArray(first.menu) && first.menu.length >= 1);
  });

  await test('4.2 Customer Interface: Register and authenticate session', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'UI Tester Customer',
        email: uiCustomerEmail,
        phone: '+91 9123456780',
        password: 'UiTestPassword@2026',
        role: 'customer'
      })
    });
    const data = await res.json();
    assert.equal(res.status, 201);
    assert.equal(data.user.role, 'customer');
    customerToken = data.token;
  });

  await test('4.3 Customer Interface: Checkout flow creates order and verifies calculations', async () => {
    const kitchensRes = await fetch(`${BASE_URL}/api/restaurants`);
    const kitchens = await kitchensRes.json();
    const k = kitchens[0];
    const dish = k.menu[0];

    const orderRes = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        restaurantId: k._id,
        items: [{ menuItemId: dish._id, qty: 2 }],
        couponCode: 'TRUE50',
        tip: 20,
        paymentMethod: 'COD',
        customerName: 'UI Tester Customer',
        customerPhone: '+91 9123456780',
        deliveryAddress: 'Flat 402, Sunshine Apartments, Indirapuram'
      })
    });
    const order = await orderRes.json();
    assert.equal(orderRes.status, 201);
    assert.ok(order.orderCode.startsWith('TH-'));
    assert.equal(order.status, 'CONFIRMED');
    createdOrderId = order._id;
    createdOrderCode = order.orderCode;
    createdOrderOtp = order.deliveryOtp;
  });

  await test('4.4 Delivery Partner Interface: Provision rider account and access dashboard', async () => {
    const riderRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Super Rider Express',
        email: uiRiderEmail,
        phone: '+91 9876500000',
        password: 'UiTestPassword@2026',
        role: 'delivery_partner'
      })
    });
    const riderData = await riderRes.json();
    assert.equal(riderRes.status, 202);
    assert.equal(riderData.user.role, 'delivery_partner');
    assert.equal(riderData.pendingApproval, true);

    const jwt = require('jsonwebtoken');
    adminToken = jwt.sign(
      { sub: 'admin-ui-test', role: 'admin' },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' }
    );
    const approvalRes = await fetch(`${BASE_URL}/api/admin/delivery-partners/${riderData.user.id}/approve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(approvalRes.status, 200);

    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: uiRiderEmail,
        password: 'UiTestPassword@2026',
        role: 'delivery_partner'
      })
    });
    const loginData = await loginRes.json();
    assert.equal(loginRes.status, 200);
    riderToken = loginData.token;

    // Delivery partner views active deliveries
    const ordersRes = await fetch(`${BASE_URL}/api/delivery/orders`, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    assert.equal(ordersRes.status, 200);
    const orders = await ordersRes.json();
    assert.ok(Array.isArray(orders));
  });

  await test('4.5 Delivery Partner Interface: Claim order and progress delivery', async () => {
    // Admin or system marks order PREPARING
    await fetch(`${BASE_URL}/api/admin/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'PREPARING' })
    });

    // Rider claims order
    const claimRes = await fetch(`${BASE_URL}/api/delivery/orders/${createdOrderId}/claim`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    const claimData = await claimRes.json();
    assert.equal(claimRes.status, 200);
    assert.equal(claimData.assignedPartnerName, 'Super Rider Express');

    // Rider updates to OUT_FOR_DELIVERY
    const outRes = await fetch(`${BASE_URL}/api/delivery/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${riderToken}`
      },
      body: JSON.stringify({ status: 'OUT_FOR_DELIVERY' })
    });
    assert.equal(outRes.status, 200);
  });

  await test('4.6 Live Order Tracker Interface: Stream status updates over SSE in real time', async () => {
    const sseRes = await fetch(`${BASE_URL}/api/orders/${createdOrderCode}/stream`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.equal(sseRes.status, 200);
    assert.ok(sseRes.headers.get('content-type')?.includes('text/event-stream'));

    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();

    // Verify initial stream payload
    const { value: chunk1 } = await reader.read();
    const text1 = decoder.decode(chunk1);
    assert.ok(text1.includes('data:'));
    assert.ok(text1.includes(createdOrderCode));
    assert.ok(text1.includes('OUT_FOR_DELIVERY'));

    // Rider completes delivery
    await fetch(`${BASE_URL}/api/delivery/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${riderToken}`
      },
      body: JSON.stringify({ status: 'DELIVERED', otp: createdOrderOtp })
    });

    // Stream receives DELIVERED broadcast
    const { value: chunk2 } = await reader.read();
    const text2 = decoder.decode(chunk2);
    assert.ok(text2.includes('DELIVERED'));

    await reader.cancel();
  });

  // ─── Phase 5: Reviews Engine Interface ────────────────────────────────────
  console.log('\n📌 Phase 5: Customer Ratings & Reviews Engine Interface');

  await test('5.1 Review API: POST review for a DELIVERED order returns 201', async () => {
    // Register a fresh customer
    const runId = Date.now();
    const email = `uirev_${runId}@truehomes.test`;
    reviewTestEmail = email;
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'UI Rev Tester', email, password: 'TestPass@2026', role: 'customer' })
    });
    const regData = await regRes.json();
    const custToken = regData.token;

    // Get a real restaurant + menu item
    const restArr = await (await fetch(`${BASE_URL}/api/restaurants`)).json();
    const rest = restArr[0];
    const dish = rest.menu[0];

    // Place order using real menuItemId
    const orderRes = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({
        restaurantId: rest._id,
        items: [{ menuItemId: dish._id, qty: 1 }],
        tip: 0,
        customerName: 'UI Rev',
        customerPhone: '9898989898',
        deliveryAddress: '1 Test Lane, Bengaluru'
      })
    });
    const orderData = await orderRes.json();
    assert.ok(orderData._id, `Order creation failed: ${JSON.stringify(orderData)}`);
    const orderId = orderData._id;
    const orderCode = orderData.orderCode;
    reviewTestOrderCode = orderCode;

    // Verify payment (simulated — this sets status to PAID)
    await fetch(`${BASE_URL}/api/orders/${orderId}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({ razorpay_order_id: 'x', razorpay_payment_id: 'y', razorpay_signature: 'z' })
    });

    // Try to get admin token from env
    const adminEmail2 = process.env.ADMIN_EMAIL || '';
    const adminPass2 = process.env.ADMIN_PASSWORD || '';
    let aToken = '';
    if (adminEmail2 && adminPass2) {
      const aRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail2, password: adminPass2 })
      });
      aToken = (await aRes.json()).token || '';
    }

    if (aToken) {
      await fetch(`${BASE_URL}/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aToken}` },
        body: JSON.stringify({ status: 'DELIVERED' })
      });
    }

    // Post review — expect 201 (delivered) or 400 (not delivered when no admin token)
    const revRes = await fetch(`${BASE_URL}/api/orders/${orderCode}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({ foodRating: 4, deliveryRating: 5, comment: 'Interface test review' })
    });

    assert.ok([201, 400].includes(revRes.status), `Unexpected status ${revRes.status}`);
    if (revRes.status === 201) {
      const revData = await revRes.json();
      assert.equal(revData.foodRating, 4);
      assert.equal(revData.orderCode, orderCode);
    }
  });

  await test('5.2 GET /api/restaurants/:id/reviews returns JSON array', async () => {
    const restArr = await (await fetch(`${BASE_URL}/api/restaurants`)).json();
    const rest = restArr[0];
    assert.ok(rest && rest._id, 'No restaurants found');

    const revListRes = await fetch(`${BASE_URL}/api/restaurants/${rest._id}/reviews`);
    assert.equal(revListRes.status, 200);
    const reviews = await revListRes.json();
    assert.ok(Array.isArray(reviews), 'reviews must be a JSON array');
  });

  await test('5.3 Remove temporary UI test accounts, orders, and sessions', async () => {
    const mongoose = require('mongoose');
    const User = require('./models/User');
    const Order = require('./models/Order');
    const Review = require('./models/Review');
    const RefreshSession = require('./models/RefreshSession');
    const emails = [uiCustomerEmail, uiRiderEmail, reviewTestEmail].filter(Boolean);
    const orderCodes = [createdOrderCode, reviewTestOrderCode].filter(Boolean);
    await mongoose.connect(process.env.MONGO_URI);
    const users = await User.find({ email: { $in: emails } }).select('_id').lean();
    const userIds = users.map((user) => user._id);
    if (orderCodes.length) {
      await Review.deleteMany({ orderCode: { $in: orderCodes } });
      await Order.deleteMany({ orderCode: { $in: orderCodes } });
    }
    if (userIds.length) {
      await RefreshSession.deleteMany({ userId: { $in: userIds } });
      await User.deleteMany({ _id: { $in: userIds } });
    }
    await mongoose.disconnect();
  });

  if (serverProc && !serverProc.killed) {
    serverProc.kill('SIGTERM');
  }

  console.log('\n====================================================');
  console.log(`📊 Test Results: ${passed} / ${total} tests passed (${Math.round((passed / total) * 100)}%)`);
  console.log('====================================================');

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runInterfaceTests();
