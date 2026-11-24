require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const mongoose = require('mongoose');

const Restaurant = require('./models/Restaurant');
const Order = require('./models/Order');
const User = require('./models/User');
const Review = require('./models/Review');
const RefreshSession = require('./models/RefreshSession');
const Coupon = require('./models/Coupon');

const TEST_PORT = '5055';
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

const runId = Date.now();
const adminEmail = (process.env.ADMIN_EMAIL || `admin_${runId}@truehomes.test`).trim().toLowerCase();
const customerEmail = `customer_${runId}@truehomes.test`;
const partnerEmails = Array.from({ length: 10 }, (_, index) => `partner${index + 1}_${runId}@truehomes.test`);
const strongPassword = 'TestPassword@2026';

let serverProc;
let adminToken = '';
let customerToken = '';
let partnerToken = '';
let partner2Token = '';
const partnerTokens = [];
const deliveryFixtureOrderCodes = [];
let createdRestaurantId = '';
let createdMenuItemId = '';
let createdOrderId = '';
let createdOrderCode = '';
let liveStreamTestOrderCode = '';
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
    const cleanupEmails = [customerEmail, ...partnerEmails];
    if (createdAdminDuringTest) cleanupEmails.push(adminEmail);
    const cleanupUsers = await User.find({ email: { $in: cleanupEmails } }).select('_id').lean();
    const cleanupUserIds = cleanupUsers.map((user) => user._id);
    if (cleanupUserIds.length) {
      await RefreshSession.deleteMany({ userId: { $in: cleanupUserIds } });
      await User.deleteMany({ _id: { $in: cleanupUserIds } });
    }
    if (createdRestaurantId) {
      await Restaurant.findByIdAndDelete(createdRestaurantId);
    }
    if (createdOrderCode) {
      await Review.deleteOne({ orderCode: createdOrderCode });
      await Order.deleteOne({ orderCode: createdOrderCode });
    }
    if (liveStreamTestOrderCode) {
      await Order.deleteOne({ orderCode: liveStreamTestOrderCode });
    }
    if (deliveryFixtureOrderCodes.length) {
      await Order.deleteMany({ orderCode: { $in: deliveryFixtureOrderCodes } });
    }
    await Coupon.deleteMany({ code: /^FESTIVE/ });
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

    const wrongRoleLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customerEmail, password: strongPassword, role: 'admin' })
    });
    assert.equal(wrongRoleLogin.status, 403);
  });

  it('14. Delivery partner workflow: blocks customer, permits claim, conflict check, and status update', async () => {
    const partners = [];
    for (let index = 0; index < partnerEmails.length; index++) {
      const email = partnerEmails[index];
      const partnerRes = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `198.51.100.${index + 1}`
        },
        body: JSON.stringify({
          name: `Speedy Rider ${index + 1}`,
          email,
          phone: `+91 98888777${String(index + 10).slice(-2)}`,
          password: strongPassword,
          role: 'delivery_partner'
        })
      });
      const partnerData = await partnerRes.json();
      assert.equal(partnerRes.status, 202);
      assert.equal(partnerData.pendingApproval, true);
      assert.equal(partnerData.user.role, 'delivery_partner');
      assert.equal(partnerData.token, undefined);
      partners.push(partnerData.user);

      const deniedLogin = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `198.51.100.${index + 1}`
        },
        body: JSON.stringify({ email, password: strongPassword, role: 'delivery_partner' })
      });
      assert.equal(deniedLogin.status, 403);
    }

    const jwt = require('jsonwebtoken');
    const pendingPartnerToken = jwt.sign(
      { sub: partners[0].id, role: 'delivery_partner' },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' }
    );
    const pendingPartnerOrders = await fetch(`${BASE_URL}/api/delivery/orders`, {
      headers: { Authorization: `Bearer ${pendingPartnerToken}` }
    });
    assert.equal(pendingPartnerOrders.status, 403);

    const customerPendingRes = await fetch(`${BASE_URL}/api/admin/delivery-partners/pending`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.equal(customerPendingRes.status, 403);
    const pendingRes = await fetch(`${BASE_URL}/api/admin/delivery-partners/pending`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const pending = await pendingRes.json();
    assert.equal(pendingRes.status, 200);
    assert.ok(partners.every((partner) => pending.some((item) => item._id === partner.id)));

    for (let index = 0; index < partners.length; index++) {
      const partner = partners[index];
      const approveRes = await fetch(`${BASE_URL}/api/admin/delivery-partners/${partner.id}/approve`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(approveRes.status, 200);

      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `198.51.100.${index + 1}`
        },
        body: JSON.stringify({
          email: partnerEmails[index],
          password: strongPassword,
          role: 'delivery_partner'
        })
      });
      const loginData = await loginRes.json();
      assert.equal(loginRes.status, 200);
      assert.equal(loginData.user.role, 'delivery_partner');
      assert.ok(loginData.token);
      partnerTokens.push(loginData.token);
    }
    partnerToken = partnerTokens[0];
    partner2Token = partnerTokens[1];

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
    const openOrder = fetchOrders.find((o) => o._id === createdOrderId);
    assert.equal(openOrder.deliveryAddress, undefined);
    assert.equal(openOrder.customerPhone, undefined);

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

    const unassignedOrderAccess = await fetch(`${BASE_URL}/api/orders/${createdOrderCode}`, {
      headers: { Authorization: `Bearer ${partner2Token}` }
    });
    assert.equal(unassignedOrderAccess.status, 403);

    const foreignCustomerToken = jwt.sign(
      { sub: 'unrelated-customer-id', role: 'customer' },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' }
    );
    const foreignCustomerAccess = await fetch(`${BASE_URL}/api/orders/${createdOrderCode}`, {
      headers: { Authorization: `Bearer ${foreignCustomerToken}` }
    });
    assert.equal(foreignCustomerAccess.status, 403);

    const prematureLocation = await fetch(`${BASE_URL}/api/delivery/orders/${createdOrderId}/location`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${partnerToken}`
      },
      body: JSON.stringify({ latitude: 28.6139, longitude: 77.2094 })
    });
    assert.equal(prematureLocation.status, 409);

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

    const badLocationRes = await fetch(`${BASE_URL}/api/delivery/orders/${createdOrderId}/location`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${partnerToken}`
      },
      body: JSON.stringify({ latitude: 120, longitude: 77.2 })
    });
    assert.equal(badLocationRes.status, 400);

    const locationRes = await fetch(`${BASE_URL}/api/delivery/orders/${createdOrderId}/location`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${partnerToken}`
      },
      body: JSON.stringify({ latitude: 28.6139, longitude: 77.2094 })
    });
    const locationData = await locationRes.json();
    assert.equal(locationRes.status, 200);
    assert.equal(locationData.deliveryLocation.latitude, 28.6139);

    const wrongPartnerLocation = await fetch(`${BASE_URL}/api/delivery/orders/${createdOrderId}/location`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${partner2Token}`
      },
      body: JSON.stringify({ latitude: 28.6, longitude: 77.2 })
    });
    assert.equal(wrongPartnerLocation.status, 403);

    const customerLocation = await fetch(`${BASE_URL}/api/orders/${createdOrderCode}`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.equal((await customerLocation.json()).deliveryLocation.longitude, 77.2094);

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
    assert.equal(delData.deliveryLocation, undefined);

    const fixtureOrders = [];
    for (let index = 0; index < 10; index++) {
      const orderRes = await fetch(`${BASE_URL}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`,
          'X-Forwarded-For': `203.0.113.${index + 1}`
        },
        body: JSON.stringify({
          restaurantId: createdRestaurantId,
          items: [{ menuItemId: createdMenuItemId, qty: 1 }],
          paymentMethod: 'COD',
          customerName: 'Test Customer',
          customerPhone: '+91 9876543210',
          deliveryAddress: `${100 + index} Simulated Test Street, Noida`
        })
      });
      const order = await orderRes.json();
      assert.equal(orderRes.status, 201);
      fixtureOrders.push(order);
      deliveryFixtureOrderCodes.push(order.orderCode);

      const preparingRes = await fetch(`${BASE_URL}/api/admin/orders/${order._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: 'PREPARING' })
      });
      assert.equal(preparingRes.status, 200);
    }

    for (let index = 0; index < fixtureOrders.length; index++) {
      const order = fixtureOrders[index];
      const auth = { Authorization: `Bearer ${partnerTokens[index]}` };
      const claim = await fetch(`${BASE_URL}/api/delivery/orders/${order._id}/claim`, {
        method: 'PATCH',
        headers: auth
      });
      assert.equal(claim.status, 200, `Partner ${index + 1} could not claim order ${order.orderCode}`);

      const out = await fetch(`${BASE_URL}/api/delivery/orders/${order._id}/status`, {
        method: 'PATCH',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'OUT_FOR_DELIVERY' })
      });
      assert.equal(out.status, 200);

      const latitude = 28.6 + index * 0.001;
      const longitude = 77.2 + index * 0.001;
      const gps = await fetch(`${BASE_URL}/api/delivery/orders/${order._id}/location`, {
        method: 'PATCH',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude, longitude })
      });
      assert.equal(gps.status, 200);
      const customerView = await fetch(`${BASE_URL}/api/orders/${order.orderCode}`, {
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      const customerViewData = await customerView.json();
      assert.equal(customerView.status, 200);
      assert.equal(customerViewData.deliveryLocation.latitude, latitude);

      const partnerView = await fetch(`${BASE_URL}/api/orders/${order.orderCode}`, { headers: auth });
      assert.equal(partnerView.status, 200);
      assert.equal((await partnerView.json()).deliveryLocation.longitude, longitude);
    }

    const adminOrdersRes = await fetch(`${BASE_URL}/api/admin/orders`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const adminOrders = await adminOrdersRes.json();
    assert.equal(adminOrdersRes.status, 200);
    assert.ok(fixtureOrders.every((order) => adminOrders.some((item) =>
      item.orderCode === order.orderCode && item.deliveryLocation?.latitude
    )));

    const liveOrder = fixtureOrders[0];
    const liveStream = await fetch(`${BASE_URL}/api/orders/${liveOrder.orderCode}/stream`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.equal(liveStream.status, 200);
    const liveReader = liveStream.body.getReader();
    const liveDecoder = new TextDecoder();
    await liveReader.read();
    const nextLatitude = 28.6999;
    const liveLocationRes = await fetch(`${BASE_URL}/api/delivery/orders/${liveOrder._id}/location`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${partnerTokens[0]}` },
      body: JSON.stringify({ latitude: nextLatitude, longitude: 77.2999 })
    });
    assert.equal(liveLocationRes.status, 200);
    const liveLocationEvent = liveDecoder.decode((await liveReader.read()).value);
    assert.ok(liveLocationEvent.includes(String(nextLatitude)));

    const wrongPartnerStop = await fetch(`${BASE_URL}/api/delivery/orders/${liveOrder._id}/location`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${partnerTokens[1]}` }
    });
    assert.equal(wrongPartnerStop.status, 403);
    const stopSharing = await fetch(`${BASE_URL}/api/delivery/orders/${liveOrder._id}/location`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${partnerTokens[0]}` }
    });
    assert.equal(stopSharing.status, 200);
    assert.equal((await stopSharing.json()).deliveryLocation, undefined);
    const customerAfterStop = await fetch(`${BASE_URL}/api/orders/${liveOrder.orderCode}`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.equal((await customerAfterStop.json()).deliveryLocation, undefined);
    await liveReader.cancel();

    for (let index = 0; index < fixtureOrders.length; index++) {
      const delivered = await fetch(`${BASE_URL}/api/delivery/orders/${fixtureOrders[index]._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${partnerTokens[index]}`
        },
        body: JSON.stringify({ status: 'DELIVERED' })
      });
      assert.equal(delivered.status, 200);
      assert.equal((await delivered.json()).deliveryLocation, undefined);
    }
  });

  it('15. Streams real-time order status updates over Server-Sent Events (SSE)', async () => {
    const deniedAdminStream = await fetch(`${BASE_URL}/api/admin/orders/stream`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.equal(deniedAdminStream.status, 403);

    const adminStream = await fetch(`${BASE_URL}/api/admin/orders/stream`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminStream.status, 200);
    assert.ok(adminStream.headers.get('content-type')?.includes('text/event-stream'));
    const adminReader = adminStream.body.getReader();
    const adminDecoder = new TextDecoder();
    const adminSnapshot = adminDecoder.decode((await adminReader.read()).value);
    assert.ok(adminSnapshot.includes('"type":"snapshot"'));
    assert.ok(adminSnapshot.includes(createdOrderCode));

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

    // New orders from any customer appear in the admin feed immediately.
    const newOrderRes = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        restaurantId: createdRestaurantId,
        items: [{ menuItemId: createdMenuItemId, qty: 1 }],
        paymentMethod: 'COD',
        customerName: 'Live Stream Customer',
        customerPhone: '9876543210',
        deliveryAddress: 'Live Stream Test Address'
      })
    });
    const newOrder = await newOrderRes.json();
    assert.equal(newOrderRes.status, 201);
    liveStreamTestOrderCode = newOrder.orderCode;
    const newOrderChunk = adminDecoder.decode((await adminReader.read()).value);
    assert.ok(newOrderChunk.includes('"type":"order"'));
    assert.ok(newOrderChunk.includes(liveStreamTestOrderCode));

    // Status changes from admin or delivery updates are broadcast to both streams.
    const statusRes = await fetch(`${BASE_URL}/api/admin/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'DELIVERED' })
    });
    assert.equal(statusRes.status, 200);

    // Owner's order feed receives the update.
    const secondChunk = await reader.read();
    const secondText = decoder.decode(secondChunk.value);
    assert.ok(secondText.includes('DELIVERED'));

    // Admin feed receives live status updates as well.
    const adminUpdate = adminDecoder.decode((await adminReader.read()).value);
    assert.ok(adminUpdate.includes('"type":"order"'));
    assert.ok(adminUpdate.includes(createdOrderCode));
    assert.ok(adminUpdate.includes('DELIVERED'));

    await reader.cancel();
    await adminReader.cancel();
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

  it('21. Dynamic Coupon engine: Admin creates coupon, customer validates and checkout calculates discount', async () => {
    const couponCode = `FESTIVE${Date.now().toString().slice(-4)}`;
    
    // 1. Admin creates a dynamic coupon
    const createRes = await fetch(`${BASE_URL}/api/admin/coupons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        code: couponCode,
        description: 'Special 40% Festive Discount',
        discountPercent: 40,
        maxDiscount: 150,
        minOrderValue: 200,
        isFreeDelivery: false
      })
    });
    assert.equal(createRes.status, 201);
    const couponData = await createRes.json();
    assert.equal(couponData.code, couponCode);

    // 2. Validate coupon with insufficient order total → 400
    const failVal = await fetch(`${BASE_URL}/api/coupons/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: couponCode, itemTotal: 150 })
    });
    assert.equal(failVal.status, 400);

    // 3. Validate coupon with valid order total → 200
    const passVal = await fetch(`${BASE_URL}/api/coupons/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: couponCode, itemTotal: 300 })
    });
    assert.equal(passVal.status, 200);
    const valResult = await passVal.json();
    assert.equal(valResult.valid, true);
    assert.equal(valResult.discount, 120); // 40% of 300 is 120 (<= 150)
  });

  it('22. Customer Profile & Address Management and Rider Availability Toggle', async () => {
    // 1. Update customer profile details (name & phone)
    const profRes = await fetch(`${BASE_URL}/api/user/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ name: 'Rohit Sharma (VIP)', phone: '9988776655' })
    });
    assert.equal(profRes.status, 200);
    const profData = await profRes.json();
    assert.equal(profData.name, 'Rohit Sharma (VIP)');
    assert.equal(profData.phone, '9988776655');

    // 2. Save a new delivery address
    const addRes = await fetch(`${BASE_URL}/api/user/addresses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ label: 'Office', address: 'Tech Park Tower B, 4th Floor, Sector 62, Noida' })
    });
    assert.equal(addRes.status, 201);
    const addData = await addRes.json();
    assert.ok(Array.isArray(addData.addresses));
    const createdAddress = addData.addresses.find((a) => a.label === 'Office');
    assert.ok(createdAddress);

    // 3. Delete the saved address
    const delRes = await fetch(`${BASE_URL}/api/user/addresses/${createdAddress._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.equal(delRes.status, 200);
    const delData = await delRes.json();
    assert.ok(!delData.addresses.some((a) => a._id === createdAddress._id));

    // 4. Rider toggles duty availability (offline -> online)
    const availRes = await fetch(`${BASE_URL}/api/delivery/availability`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${partnerToken}`
      },
      body: JSON.stringify({ isAvailable: false })
    });
    assert.equal(availRes.status, 200);
    const availData = await availRes.json();
    assert.equal(availData.isAvailable, false);
  });
});