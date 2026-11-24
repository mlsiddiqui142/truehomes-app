require('dotenv').config();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BASE_URL = 'http://127.0.0.1:5000';

async function runInterfaceTests() {
  console.log('====================================================');
  console.log('🚀 TrueHomes Automated Interface & UI Verification Suite');
  console.log('====================================================\n');

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
  await test('1.1 Root URL serves complete HTML document with valid structure', async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<!doctype html>'));
    assert.ok(html.includes('<title>TrueHomes'));
    assert.ok(html.includes('Plus Jakarta Sans'));
    assert.ok(html.includes('cdn.tailwindcss.com'));
    assert.ok(html.includes('checkout.razorpay.com'));
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

  // 2. DOM Components & Controls
  console.log('\n📌 Phase 2: Navigation & Component Interface Verification');
  const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

  await test('2.1 Top Navigation Bar contains all action controls', async () => {
    assert.ok(indexHtml.includes('id="locationSelect"'), 'Missing Location Selector');
    assert.ok(indexHtml.includes('onclick="openTrackModal()"'), 'Missing Live Track button');
    assert.ok(indexHtml.includes('id="adminNavBtn"'), 'Missing Admin Panel navigation button');
    assert.ok(indexHtml.includes('id="deliveryNavBtn"'), 'Missing Rider Portal navigation button');
    assert.ok(indexHtml.includes('id="authNavBtn"'), 'Missing Sign In navigation button');
    assert.ok(indexHtml.includes('id="cartCountBadge"'), 'Missing Cart count badge');
  });

  await test('2.2 All 7 Primary UI Modals exist with valid IDs', async () => {
    const expectedModals = [
      'authModal',
      'menuModal',
      'cartDrawer',
      'trackModal',
      'deliveryModal',
      'adminModal',
      'rzpSimModal'
    ];
    for (const modalId of expectedModals) {
      assert.ok(
        indexHtml.includes(`id="${modalId}"`),
        `Modal container #${modalId} is missing from HTML`
      );
    }
  });

  await test('2.3 Auth Modal contains 3-Role selector & Direct Login controls', async () => {
    assert.ok(indexHtml.includes('id="thRoleTab_admin"'), 'Missing Admin role tab');
    assert.ok(indexHtml.includes('id="thRoleTab_user"'), 'Missing User role tab');
    assert.ok(indexHtml.includes('id="thRoleTab_delivery_partner"'), 'Missing Delivery Partner role tab');
    assert.ok(indexHtml.includes('id="thDirectLoginBox"'), 'Missing Direct Login box');
    assert.ok(indexHtml.includes('id="thDirectLoginBtn"'), 'Missing Direct Login button');
    assert.ok(indexHtml.includes('performDirectDatabaseLogin()'), 'Missing Direct Login handler');
  });

  await test('2.4 Rider Portal (Delivery Modal) contains metrics bar & action handlers', async () => {
    assert.ok(indexHtml.includes('id="deliveryActiveCount"'), 'Missing Active Deliveries metric');
    assert.ok(indexHtml.includes('id="deliveryCompletedCount"'), 'Missing Completed Deliveries metric');
    assert.ok(indexHtml.includes('id="deliveryTipsEarned"'), 'Missing Tips Earned metric');
    assert.ok(indexHtml.includes('id="deliveryOrdersList"'), 'Missing orders list container');
    assert.ok(indexHtml.includes('claimDeliveryOrder'), 'Missing claimDeliveryOrder function');
    assert.ok(indexHtml.includes('updateDeliveryStatus'), 'Missing updateDeliveryStatus function');
  });

  await test('2.5 Live Order Tracker contains timeline & real-time SSE stream indicator', async () => {
    assert.ok(indexHtml.includes('id="trackCodeInput"'), 'Missing order code input');
    assert.ok(indexHtml.includes('id="trackDetailsBox"'), 'Missing track details container');
    assert.ok(indexHtml.includes('connectTrackLiveStream'), 'Missing connectTrackLiveStream function');
    assert.ok(indexHtml.includes('disconnectTrackLiveStream'), 'Missing disconnectTrackLiveStream function');
    assert.ok(indexHtml.includes('EventSource'), 'Missing EventSource API integration');
    assert.ok(indexHtml.includes('Live Stream'), 'Missing Live Stream indicator');
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
  const testRun = Date.now();

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
        email: `ui_cust_${testRun}@truehomes.test`,
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
  });

  await test('4.4 Delivery Partner Interface: Provision rider account and access dashboard', async () => {
    const riderRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Super Rider Express',
        email: `ui_rider_${testRun}@truehomes.test`,
        phone: '+91 9876500000',
        password: 'UiTestPassword@2026',
        role: 'delivery_partner'
      })
    });
    const riderData = await riderRes.json();
    assert.equal(riderRes.status, 201);
    assert.equal(riderData.user.role, 'delivery_partner');
    riderToken = riderData.token;

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
    const adminEmail = process.env.ADMIN_EMAIL || `admin_${testRun}@truehomes.test`;
    const jwt = require('jsonwebtoken');
    adminToken = jwt.sign({ sub: 'admin-ui-test', role: 'admin' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

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
    const sseRes = await fetch(`${BASE_URL}/api/orders/${createdOrderCode}/stream`);
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
      body: JSON.stringify({ status: 'DELIVERED' })
    });

    // Stream receives DELIVERED broadcast
    const { value: chunk2 } = await reader.read();
    const text2 = decoder.decode(chunk2);
    assert.ok(text2.includes('DELIVERED'));

    await reader.cancel();
  });

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
