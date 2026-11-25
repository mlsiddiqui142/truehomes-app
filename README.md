# TrueHomes — Homestyle & Top Rated Food Delivery

A full-stack food delivery platform built with **React 19** (Vite), **Node.js / Express 4**, and **MongoDB** (Mongoose). Features real-time order tracking via Server-Sent Events, PWA offline support, in-app chat, and a comprehensive role-based UI.

---

## Quick Start

```bash
# 1. Install dependencies
cd truehomes-app
npm install

# 2. Set up environment variables (copy .env.example → .env and fill in values)
cp .env.example .env

# 3. Seed database with sample restaurants & users
npm run seed

# 4. Start development server (Vite + Express)
npm run dev        # frontend on http://localhost:5173
node server.js     # backend API on http://localhost:3000 (or PORT in .env)
```

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server for the React frontend |
| `npm run build` | Build frontend for production (`dist/`) |
| `npm start` | Start Express production server |
| `npm test` | Run backend integration test suite (requires MongoDB) |
| `npm run test:ui` | Run UI/interface test suite (auto-starts the server) |
| `npm run seed` | Seed the database with sample data |

---

## Architecture

```
truehomes-app/
│
├─ src/react/                    ← React frontend (Vite)
│   ├─ App.jsx                   ← Root component with AppProvider, lazy modals
│   ├─ main.jsx                  ← Legacy monolithic component (kept for reference)
│   ├─ styles.css                ← Global stylesheet
│   │
│   ├─ context/
│   │   └─ AppContext.jsx        ← React Context + useReducer for user/cart/toasts
│   │
│   └─ components/
│       ├─ Header.jsx            ← Responsive navigation header (new)
│       ├─ TopBar.jsx            ← Sticky top bar with search & account menu
│       ├─ RestaurantList.jsx    ← Restaurant grid with cuisine filter pills
│       ├─ ChatModal.jsx         ← In-app live chat modal (lazy-loaded)
│       ├─ KitchenPortal.jsx     ← Kitchen owner dashboard modal (lazy-loaded)
│       └─ Toast.jsx             ← Toast notification stack (auto-dismiss 4 s)
│
├─ public/
│   ├─ index.html                ← Legacy HTML shell (Vanilla JS version)
│   ├─ service-worker.js         ← PWA service worker (skips /api/* caching)
│   └─ js/                       ← Legacy JS modules (Vanilla JS version)
│
├─ models/                       ← Mongoose schemas
│   ├─ User.js, Order.js, Restaurant.js, Review.js
│   ├─ Chat.js, WalletTransaction.js, Coupon.js, RefreshSession.js
│
├─ server.js                     ← Express API server (JWT auth, SSE, push)
├─ test.js                       ← Backend integration test suite
├─ test-interfaces.js            ← UI/interface verification suite
├─ seed.js                       ← Database seeder
├─ .github/workflows/ci.yml      ← GitHub Actions CI/CD pipeline
└─ package.json
```

### Component Hierarchy

```
<App>                        ← AppProvider wraps everything
  <AppInner>                 ← Consumes AppContext
    <TopBar />               ← Sticky navigation bar
    <RestaurantList />       ← Filter pills + restaurant grid
    <Toast />                ← Floating notification stack
    <Suspense>
      <ChatModal />          ← Lazy-loaded in-app chat
      <KitchenPortal />      ← Lazy-loaded kitchen dashboard
    </Suspense>
  </AppInner>
</App>
```

---

## User Roles

| Role | Capabilities |
|------|-------------|
| `customer` | Browse restaurants, add to cart, checkout, track orders, view/cancel orders, write reviews, use wallet & cashback |
| `kitchen_owner` | Manage restaurant (open/close), toggle dish stock, view orders, chat with customers (`Ctrl+K` shortcut) |
| `delivery_partner` | View available orders, claim deliveries, update status, share GPS location, earn tips |
| `admin` | Full dashboard: manage kitchens, approve delivery partners, view all orders (live SSE stream), manage coupons |

---

## New Features (v2)

### 1. Kitchen Owner Portal
A modal dashboard for `kitchen_owner` users, opened via the account menu or the global keyboard shortcut **`Ctrl+K`**.
- **Overview tab**: View all current orders, their status, and launch a live chat session per order.
- **Menu tab**: Toggle individual dishes between In Stock / Out of Stock.
- Toggle the entire kitchen Open / Closed with a single button.

### 2. In‑App Live Chat
Real-time chat modal attached to any order code.
- Messages stream via SSE (`/api/orders/:code/chat/stream`).
- Auto-scrolls to the latest message.
- Works for both customer and kitchen owner sides.
- Fully keyboard-accessible (Enter to send, Escape to close).

### 3. Customer Wallet & Cashback
- Wallet balance fetched from `/api/user/wallet` and shown in the account dropdown.
- At checkout, tick "Use Wallet Balance" to deduct the available amount from the order total.
- 5% cashback note displayed next to the wallet balance.

### 4. PWA Push Notifications
- A prompt banner appears on first login if `Notification.permission === "default"`.
- Accepts the VAPID-based push subscription from `/api/push/vapid-public-key`.
- Subscription state is persisted in `localStorage` (`truehomes_push_subscribed`) so the banner never shows twice.
- Full offline banner (`⚠️ You are offline`) is always visible when connectivity is lost.

---

## State Management

Global state (`user`, `cart`, `toasts`, `isOffline`) is managed via **React Context + `useReducer`** (`src/react/context/AppContext.jsx`). The `useAppContext()` hook and a convenience `toast(message)` helper are exported for use in any component.

---

## Accessibility

- All interactive elements have descriptive `aria-label` attributes.
- Modals set `role="dialog"` and `aria-modal="true"`.
- The account menu uses `aria-haspopup` / `aria-expanded`.
- Toast messages use `role="status"` and `aria-live="polite"`.
- The Kitchen Portal is opened with `Ctrl+K` (or `Cmd+K` on macOS).
- Escape key closes any open modal.

---

## CI/CD

A **GitHub Actions** workflow (`.github/workflows/ci.yml`) runs on every push/PR:
1. Spins up a MongoDB 7 service container.
2. Installs dependencies and builds the frontend.
3. Runs `npm run test:ui` (UI/interface suite).
4. Runs `npm test` (backend integration suite).
5. Checks for stray `console.log` statements in source files.

---

## Running the UI Tests Locally

```bash
cd truehomes-app
npm run test:ui
```

The suite spins up the Express server on port 5066, runs all HTTP-level interface checks, and exits with a summary. It requires a running MongoDB instance (or the CI container).

For the new Jest-style component tests:

```bash
npm install --save-dev jest @testing-library/react @testing-library/jest-dom
npx jest src/react/__tests__/newFeatures.test.js
```
