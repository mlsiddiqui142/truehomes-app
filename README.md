# TrueHomes — Homestyle & Top Rated Food Delivery

A full-stack food delivery platform built with **React 19** (Vite), **Node.js / Express 4**, and **MongoDB** (Mongoose). One React SPA for customers, kitchen owners, delivery partners, and admins, backed by a single Express API with JWT auth, real-time order tracking (SSE), in-app chat, wallet/cashback, coupons, and PWA offline + push support.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create a .env file (see "Environment Variables" below)

# 3. Seed the database with sample restaurants & users
npm run seed

# 4. Build the frontend and start the server
npm run build      # bundles src/react/main.jsx → public/react/
npm start          # http://localhost:3000
```

The Express server serves the built SPA from `public/react/` and the JSON API under `/api/*`. There is no API proxy in the Vite dev server, so `npm run dev` is only useful for iterating on UI markup; run `npm run build && npm start` for full-stack work.

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `MONGO_URI` | yes | MongoDB connection string |
| `JWT_SECRET` | yes | Signing key for access tokens (32+ chars) |
| `PORT` | no | HTTP port (default 3000) |
| `ADMIN_EMAIL` | no | Seeds/identifies the admin account |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | no | Live Razorpay payments; simulated checkout is used when unset |
| `VAPID_PUBLIC_KEY` | no | Web Push public key served to the client |
| `API_RATE_LIMIT_MAX` | no | Global API request budget per 15 min (default 150; 10000 in `NODE_ENV=test`) |

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server for the React UI (no API proxy) |
| `npm run build` | Build the SPA into `public/react/` |
| `npm start` | Start the Express server |
| `npm test` | Backend integration suite (`test.js`, node:test) |
| `npm run test:ui` | HTTP interface suite (`test-interfaces.js`, auto-starts the server) |
| `npm run test:ux` | End-to-end UX/security suite (`test-ux-rigorous.js`, needs a seeded DB) |
| `npm run seed` | Seed sample restaurants, menus, and users |

---

## Architecture

```
truehomes-app/
│
├─ src/react/
│   ├─ main.jsx                  ← The entire React SPA (single entry, no component split yet)
│   └─ styles.css                ← Global stylesheet
│
├─ index.react.html              ← Vite entry HTML (dev)
├─ vite.config.mjs               ← Builds the SPA into public/react/
│
├─ public/
│   ├─ react/                    ← Build output served by Express (committed)
│   ├─ manifest.json             ← PWA manifest
│   └─ service-worker.js         ← Offline cache + Web Push handlers
│
├─ models/                       ← Mongoose schemas
│   ├─ User.js, Order.js, Restaurant.js, Review.js
│   ├─ Chat.js, WalletTransaction.js, Coupon.js, RefreshSession.js
│
├─ server.js                     ← Express API server (JWT auth, SSE, push)
├─ seed.js                       ← Database seeder
├─ test.js                       ← Backend integration suite
├─ test-interfaces.js            ← HTTP interface suite
├─ test-ux-rigorous.js           ← End-to-end UX/security suite
└─ .github/workflows/            ← CI pipelines
```

**Single frontend.** `src/react/main.jsx` is the only UI implementation; Vite bundles it into `public/react/`, and Express serves that build for `/` and all non-API routes. Earlier experiments (a vanilla-JS app under `public/js/` and a partially-ported component tree under `src/react/components/`) have been removed so there is exactly one frontend to maintain. The service worker is registered from the SPA entry.

---

## User Roles

| Role | Capabilities |
|------|-------------|
| `customer` | Browse restaurants, cart & checkout, track orders via SSE, cancel orders (wallet/gateway refunds), chat with kitchen/rider, reviews, wallet & cashback, coupons |
| `kitchen_owner` | Toggle kitchen open/closed, mark dishes in/out of stock, view and progress orders, chat with customers |
| `delivery_partner` | Claim deliveries, update status, verify delivery OTP, share GPS, earn tips |
| `admin` | Manage kitchens, assign kitchen owners, approve riders, view all orders live, manage coupons, analytics |

## Order Lifecycle

`CONFIRMED → PREPARING → OUT_FOR_DELIVERY → DELIVERED`, plus `CANCELLED`.

- Orders can only be created for open kitchens with in-stock dishes.
- Marking an order `DELIVERED` requires the delivery OTP shown to the customer.
- Cancelling restores any wallet amount spent and refunds paid orders (Razorpay refund when configured, simulated otherwise) and records a `REFUND` wallet transaction.

---

## Testing

Three suites cover the stack at different levels:

| Suite | Command | Notes |
|-------|---------|-------|
| Backend integration | `npm test` | Spawns its own server (port 5055) and creates its own fixtures |
| HTTP interfaces | `npm run test:ui` | Spawns a server on port 5066; needs seeded restaurants |
| UX / security | `npm run test:ux` | Seeds a scratch DB first, then uses `UI_TEST_PORT` |

Each suite scopes its cleanup to data it created. **Always point `MONGO_URI` at a throwaway database** (e.g. `truehomes_test_run1`) when running tests; never at a database with real data.

---

## CI/CD

GitHub Actions workflows in `.github/workflows/` start a MongoDB service container, install dependencies, build the SPA, and run the test suites against the CI database (`truehomes_ci`).
