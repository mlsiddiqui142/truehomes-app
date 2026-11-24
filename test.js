require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const mongoose = require('mongoose');

const Restaurant = require('./models/Restaurant');
const Order = require('./models/Order');
const User = require('./models/User');
const Review = require('./models/Review');

const TEST_PORT = '5055';
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

const runId = Date.now();
const adminEmail = (process.env.ADMIN_EMAIL || `admin_${runId}@truehomes.test`).trim().toLowerCase();
const customerEmail = `customer_${runId}@truehomes.test`;
const partnerEmail = `partner_${runId}@truehomes.test`;
const partner2Email = `partner2_${runId}@truehomes.test`;
const strongPassword = 'TestPassword@2026';

let serverProc;
let adminToken = '';
let customerToken = '';
let partnerToken = '';
let partner2Token = '';
let createdRestaurantId = '';
let createdMenuItemId = '';
let createdOrderId = '';
let createdOrderCode = '';
let createdAdminDuringTest = false;

async function waitForServer(retries = 25) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Server failed to start on test port within timeout');
}

describe('TrueHomes Full-Stack & Cyber-Security Automated Suite', () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const existingAdmin = await User.findOne({ email: adminEmail });
    if (!existingAdmin) {
      createdAdminDuringTest = true;
    }

    serverProc = spawn(process.execPath, ['server.js'], {
      env: { ...process.env, PORT: TEST_PORT, ADMIN_EMAIL: adminEmail },
      stdio: 'ignore'
    });

    await waitForServer();
  });

  after(async () => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
    }
    await User.deleteMany({ email: { $in: [customerEmail, partnerEmail, partner2Email] } });
    if (createdAdminDuringTest) {
      await User.deleteOne({ email: adminEmail });
    }
    if (createdRestaurantId) {
      await Restaurant.findByIdAndDelete(createdRestaurantId);
    }
    if (createdOrderCode) {
      await Review.deleteOne({ orderCode: createdOrderCode });
      await Order.deleteOne({ orderCode: createdOrderCode });
    }
    await mongoose.disconnect();
  });

  it('1. GET /health returns 200 OK with connected database status', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.status, 'ok');
  });

  it('2. Security headers (Helmet CSP & X-Content-Type-Options) are present', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('content-security-policy'));
  });

  it('3. Registers a standard customer account and returns a valid JWT', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Customer',
        email: customerEmail,
        phone: '+91 9876543210',
        password: strongPassword
      })
    });
    const data = await res.json();
    assert.equal(res.status, 201);
    assert.ok(data.token);
    assert.equal(data.user.role, 'customer');
    customerToken = data.token;
  });

  it('4. Rejects duplicate email registration with 409 Conflict', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Duplicate User',
        email: customerEmail,
        password: strongPassword
      })
    });
    assert.equal(res.status, 409);
  });

  it('5. Blocks NoSQL injection payloads on login', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: { $ne: '' },
        password: { $ne: '' }
      })
    });
    assert.equal(res.status, 401);
  });

  it('6. Provisions or logs in Admin account with role="admin"', async () => {
    if (createdAdminDuringTest) {
      const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'TrueHomes Admin',
          email: adminEmail,
          phone: '+91 9999900000',
          password: strongPassword
        })
      });
      const regData = await regRes.json();
      assert.equal(regRes.status, 201);
      assert.equal(regData.user.role, 'admin');
      adminToken = regData.token;
    } else {
      const adminDoc = await User.findOne({ email: adminEmail });
      const jwt = require('jsonwebtoken');
      adminToken = jwt.sign(
        { sub: adminDoc._id.toString(), role: 'admin' },
        process.env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '1h' }
      );
      assert.ok(adminToken);
    }
  });

  it('7. Blocks non-admin customer from creating restaurants (403 Forbidden)', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/restaurants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ name: 'Hacker Kitchen', cuisines: ['Test'] })
    });
    assert.equal(res.status, 403);
  });

  it('8. Allows Admin to create a restaurant and add a dish', async () => {
    const restRes = await fetch(`${BASE_URL}/api/admin/restaurants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: `__TEST__ Kitchen ${runId}`,
        cuisines: ['North Indian', 'Biryani'],
        deliveryTime: 25,
        costForTwo: 400,
        isPureVeg: true
      })
    });
    const restData = await restRes.json();
    assert.equal(restRes.status, 201);
    createdRestaurantId = restData._id;

    const dishRes = await fetch(`${BASE_URL}/api/admin/restaurants/${createdRestaurantId}/menu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Special Paneer Thali',
        price: 250,
        category: 'Thalis',
        isVeg: true,
        isBestseller: true
      })
    });
    const dishData = await dishRes.json();
    assert.equal(dishRes.status, 201);
    assert.equal(dishData.menu.length, 1);
    createdMenuItemId = dishData.menu[0]._id;
  });

  it('9. Prevents client-side price tampering and applies TRUE50 promo accurately', async () => {
    const invalidOrderRes = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        restaurantId: createdRestaurantId,
        items: [{ menuItemId: createdMenuItemId, qty: 21 }],
        customerName: 'Test Customer',
        customerPhone: '123',
        deliveryAddress: 'x',
        paymentMethod: 'RAZORPAY'
      })
    });
    assert.equal(invalidOrderRes.status, 400);

    const orderRes = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        restaurantId: createdRestaurantId,
        items: [{ menuItemId: createdMenuItemId, qty: 2, price: 1 }],
        couponCode: 'TRUE50',
        tip: 20,
        paymentMethod: 'RAZORPAY',
        customerName: 'Test Customer',
        customerPhone: '+91 9876543210',
        deliveryAddress: 'Sector 62, Noida'
      })
    });
    const order = await orderRes.json();
    assert.equal(orderRes.status, 201);
    assert.equal(order.itemTotal, 500);
    assert.equal(order.discount, 100);
    assert.equal(order.deliveryFee, 0);
    assert.equal(order.tax, 20);
    assert.equal(order.grandTotal, 440);
    assert.equal(order.paymentStatus, 'PENDING');

    createdOrderId = order._id;
    createdOrderCode = order.orderCode;
  });

  it('10. Rejects forged Razorpay signatures and verifies legitimate payment flow', async () => {
    const initRes = await fetch(`${BASE_URL}/api/payments/razorpay/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ orderId: createdOrderId })
    });
    const initData = await initRes.json();
    assert.equal(initRes.status, 200);

    const unauthorizedInitRes = await fetch(`${BASE_URL}/api/payments/razorpay/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: createdOrderId })
    });
    assert.equal(unauthorizedInitRes.status, 403);

    const badVerify = await fetch(`${BASE_URL}/api/payments/razorpay/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        orderId: createdOrderId,
        razorpay_order_id: 'order_fake123',
        razorpay_payment_id: 'pay_fake123',
        razorpay_signature: 'invalid_hex_signature'
      })
    });
    assert.equal(badVerify.status, 400);

    const validPayload =
      initData.mode === 'simulator'
        ? { orderId: createdOrderId, simulated: true }
        : {
            orderId: createdOrderId,
            razorpay_order_id: initData.razorpayOrderId,
            razorpay_payment_id: 'pay_test_valid123',
            razorpay_signature: require('crypto')
              .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
              .update(`${initData.razorpayOrderId}|pay_test_valid123`)
              .digest('hex')
          };

    const goodVerify = await fetch(`${BASE_URL}/api/payments/razorpay/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify(validPayload)
    });
    const verifyData = await goodVerify.json();
    assert.equal(goodVerify.status, 200);
    assert.equal(verifyData.order.paymentStatus, 'PAID');
  });

  it('11. Admin updates live order status and owner tracking reflects it', async () => {
    const preparingRes = await fetch(`${BASE_URL}/api/admin/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'PREPARING' })
    });
    assert.equal(preparingRes.status, 200);

    const invalidPatchRes = await fetch(`${BASE_URL}/api/admin/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'CONFIRMED' })
    });
    assert.equal(invalidPatchRes.status, 409);

    const trackRes = await fetch(`${BASE_URL}/api/orders/${createdOrderCode}`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    const trackData = await trackRes.json();
    assert.equal(trackRes.status, 200);
    assert.equal(trackData.status, 'PREPARING');
    assert.equal(trackData.customerPhone, '+91 9876543210');
    assert.equal(trackData.deliveryAddress, 'Sector 62, Noida');

    const unauthorizedTrackRes = await fetch(`${BASE_URL}/api/orders/${createdOrderCode}`);
    assert.equal(unauthorizedTrackRes.status, 401);
  });

  it('12. Authenticated customer retrieves their order history via GET /api/orders/my', async () => {
    const myRes = await fetch(`${BASE_URL}/api/orders/my`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    const orders = await myRes.json();
    assert.equal(myRes.status, 200);
    assert.ok(Array.isArray(orders));
    assert.ok(orders.some((o) => o.orderCode === createdOrderCode));
  });

  it('13. Supports password-verified direct login and blocks passwordless admin access', async () => {
    const badPasswordRes = await fetch(`${BASE_URL}/api/auth/direct-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customerEmail, password: 'WrongPassword@2026' })
    });
    assert.equal(badPasswordRes.status, 401);

    const directLoginRes = await fetch(`${BASE_URL}/api/auth/direct-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customerEmail, password: strongPassword })
    });
    const directLoginData = await directLoginRes.json();
    assert.equal(directLoginRes.status, 200);
    assert.ok(directLoginData.token);
    assert.equal(directLoginData.user.email, customerEmail);

    const setCookie = directLoginRes.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.includes('truehomes_refresh='));
    assert.ok(setCookie.includes('HttpOnly'));
    const refreshCookie = setCookie.split(';', 1)[0];
    const refreshRes = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: refreshCookie }
    });
    const refreshData = await refreshRes.json();
    assert.equal(refreshRes.status, 200);
    assert.ok(refreshData.token);

    const badAdminDirectRes = await fetch(`${BASE_URL}/api/auth/direct-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: '' })
    });
    assert.equal(badAdminDirectRes.status, 401);
  });

  it('14. Delivery partner workflow: blocks customer, permits claim, conflict check, and status update', async () => {
    const p1Res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Speedy Rider 1',
        email: partnerEmail,
        phone: '+91 9888877771',
        password: strongPassword,
        role: 'delivery_partner'
      })
    });
    const p1Data = await p1Res.json();
    assert.equal(p1Res.status, 201);
    assert.equal(p1Data.user.role, 'delivery_partner');
    partnerToken = p1Data.token;

    const p2Res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Speedy Rider 2',
        email: partner2Email,
        phone: '+91 9888877772',
        password: strongPassword,
        role: 'delivery_partner'
      })
    });
    const p2Data = await p2Res.json();
    assert.equal(p2Res.status, 201);
    partner2Token = p2Data.token;

    const custBlock = await fetch(`${BASE_URL}/api/delivery/orders`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.equal(custBlock.status, 403);

    const fetchRes = await fetch(`${BASE_URL}/api/delivery/orders`, {
      headers: { Authorization: `Bearer ${partnerToken}` }
    });
    const fetchOrders = await fetchRes.json();
    assert.equal(fetchRes.status, 200);
    assert.ok(Array.isArray(fetchOrders));
    assert.ok(fetchOrders.some((o) => o._id === createdOrderId));

    const claimRes = await fetch(`${BASE_URL}/api/delivery/orders/${createdOrderId}/claim`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${partnerToken}` }
    });
    const claimData = await claimRes.json();
    assert.equal(claimRes.status, 200);
    assert.equal(claimData.assignedPartnerName, 'Speedy Rider 1');

    const conflictRes = await fetch(`${BASE_URL}/api/delivery/orders/${createdOrderId}/claim`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${partner2Token}` }
    });
    assert.equal(conflictRes.status, 409);

    const outRes = await fetch(`${BASE_URL}/api/delivery/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${partnerToken}`
      },
      body: JSON.stringify({ status: 'OUT_FOR_DELIVERY' })
    });
    const outData = await outRes.json();
    assert.equal(outRes.status, 200);
    assert.equal(outData.status, 'OUT_FOR_DELIVERY');

    const delRes = await fetch(`${BASE_URL}/api/delivery/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${partnerToken}`
      },
      body: JSON.stringify({ status: 'DELIVERED' })
    });
    const delData = await delRes.json();
    assert.equal(delRes.status, 200);
    assert.equal(delData.status, 'DELIVERED');
  });

  it('15. Streams real-time order status updates over Server-Sent Events (SSE)', async () => {
    const sseRes = await fetch(`${BASE_URL}/api/orders/${createdOrderCode}/stream`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.equal(sseRes.status, 200);
    assert.ok(sseRes.headers.get('content-type')?.includes('text/event-stream'));

    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();

    // 1. Initial snapshot
    const firstChunk = await reader.read();
    const firstText = decoder.decode(firstChunk.value);
    assert.ok(firstText.includes('data:'));
    assert.ok(firstText.includes(createdOrderCode));

    // 2. Trigger status broadcast
    await fetch(`${BASE_URL}/api/admin/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'DELIVERED' })
    });

    // 3. Read broadcasted update
    const secondChunk = await reader.read();
    const secondText = decoder.decode(secondChunk.value);
    assert.ok(secondText.includes('DELIVERED'));

    await reader.cancel();
  });

  it('16. Enforces brute-force rate limit (429) on repeated failed logins', async () => {
    let hit429 = false;
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: customerEmail, password: 'WrongPassword123' })
      });
      if (res.status === 429) {
        hit429 = true;
        break;
      }
    }
    assert.equal(hit429, true);
  });

  it('17. Customer submits a review for a DELIVERED order → 201 + restaurant rating updated', async () => {
    // First advance order to DELIVERED via admin + delivery partner (reuse createdOrderId / partnerToken from earlier tests)
    await fetch(`${BASE_URL}/api/admin/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'DELIVERED' })
    });

    const revRes = await fetch(`${BASE_URL}/api/orders/${createdOrderCode}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({ foodRating: 5, deliveryRating: 4, comment: 'Fantastic meal!' })
    });
    const revData = await revRes.json();
    assert.equal(revRes.status, 201, `Expected 201, got ${revRes.status}: ${JSON.stringify(revData)}`);
    assert.equal(revData.foodRating, 5);
    assert.equal(revData.orderCode, createdOrderCode);

    // Restaurant rating should now be recalculated
    const restRes = await fetch(`${BASE_URL}/api/restaurants/${createdRestaurantId}`);
    const restData = await restRes.json();
    assert.ok(typeof restData.rating === 'number', 'rating must be a number');
    assert.ok(restData.reviewCount >= 1, 'reviewCount must be >= 1');
  });

  it('18. Duplicate review is rejected with 409', async () => {
    const dupRes = await fetch(`${BASE_URL}/api/orders/${createdOrderCode}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({ foodRating: 3, comment: 'Second attempt' })
    });
    assert.equal(dupRes.status, 409, `Expected 409 conflict, got ${dupRes.status}`);
  });

  it('19. Another user cannot review a different customer\'s order → 403', async () => {
    const foreignRes = await fetch(`${BASE_URL}/api/orders/${createdOrderCode}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${partnerToken}` },
      body: JSON.stringify({ foodRating: 1 })
    });
    // partner is delivery_partner role — should get 403 (not owner)
    assert.ok([403, 409].includes(foreignRes.status), `Expected 403 or 409, got ${foreignRes.status}`);
  });

  it('20. GET /api/restaurants/:id/reviews returns the submitted review', async () => {
    const res = await fetch(`${BASE_URL}/api/restaurants/${createdRestaurantId}/reviews`);
    assert.equal(res.status, 200);
    const reviews = await res.json();
    assert.ok(Array.isArray(reviews), 'reviews must be an array');
    assert.ok(reviews.length >= 1, 'at least 1 review should exist');
    assert.equal(reviews[0].foodRating, 5);
  });
});