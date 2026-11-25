import React, { lazy, Suspense, useEffect, useCallback, useReducer, useState, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider, useAppContext } from "./context/AppContext.jsx";
import TopBar from "./components/TopBar.jsx";
import RestaurantList from "./components/RestaurantList.jsx";
import Toast from "./components/Toast.jsx";
import "./styles.css";

// ─── Lazy-loaded heavy modals ─────────────────────────────────────────────────
const ChatModal        = lazy(() => import("./components/ChatModal.jsx"));
const KitchenPortal    = lazy(() => import("./components/KitchenPortal.jsx"));

const ModalFallback = () => (
  <div className="modal-backdrop" role="status" aria-label="Loading modal…">
    <div className="modal" style={{ textAlign: "center", padding: 40 }}>
      <span style={{ fontSize: 32 }}>⏳</span>
      <p>Loading…</p>
    </div>
  </div>
);

// ─── API helper ───────────────────────────────────────────────────────────────
/**
 * Authenticated API call helper.
 * @param {string} path       - API path e.g. "/api/restaurants"
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function api(path, options = {}) {
  const token = localStorage.getItem("truehomes_token");
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, credentials: "include" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ─── App (inner) – consumes context ──────────────────────────────────────────
function AppInner() {
  const { state, dispatch, toast } = useAppContext();
  const { user, cart, isOffline } = state;

  // ── UI visibility state (kept local – not shared globally) ──
  const [search, setSearch]                   = useState("");
  const [restaurants, setRestaurants]         = useState([]);
  const [accountOpen, setAccountOpen]         = useState(false);
  const [authOpen, setAuthOpen]               = useState(false);
  const [authMode, setAuthMode]               = useState("login");
  const [authRole, setAuthRole]               = useState("customer");
  const [cartOpen, setCartOpen]               = useState(false);
  const [trackerOpen, setTrackerOpen]         = useState(false);
  const [kitchenOpen, setKitchenOpen]         = useState(false);
  const [adminOpen, setAdminOpen]             = useState(false);
  const [deliveryOpen, setDeliveryOpen]       = useState(false);
  const [customerOrdersOpen, setCustomerOrdersOpen] = useState(false);

  // Kitchen portal state
  const [myKitchen, setMyKitchen]       = useState(null);
  const [kitchenOrders, setKitchenOrders] = useState([]);
  const [kitchenTab, setKitchenTab]     = useState("orders");

  // Chat modal state
  const [chatOrderCode, setChatOrderCode] = useState(null);
  const [chatMessages, setChatMessages]   = useState([]);
  const [chatInput, setChatInput]         = useState("");
  const chatAbortRef                      = useRef(null);

  // Wallet state
  const [walletData, setWalletData]         = useState({ balance: 0 });
  const [useWalletBalance, setUseWalletBalance] = useState(false);

  // Push notification state
  const [showPushPrompt, setShowPushPrompt] = useState(false);

  // Favorites
  const [favorites, setFavorites] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("truehomes_favs") || "[]")); }
    catch (_) { return new Set(); }
  });

  // Cuisine filter
  const [cuisineFilter, setCuisineFilter] = useState("All");
  const [globalVegOnly, setGlobalVegOnly] = useState(false);

  // ── Effects ─────────────────────────────────────────────────────────────────

  // Load restaurants on search change
  useEffect(() => {
    api(`/api/restaurants?search=${encodeURIComponent(search)}`)
      .then(setRestaurants)
      .catch(() => toast("Unable to load kitchens. Please try again."));
  }, [search]);

  // Restore session on mount
  useEffect(() => {
    const token = localStorage.getItem("truehomes_token");
    if (!token) return;
    api("/api/auth/me")
      .then((u) => {
        dispatch({ type: "SET_USER", payload: u });
        if (u.role === "admin") setAdminOpen(true);
        if (u.role === "delivery_partner") setDeliveryOpen(true);
        if (u.role === "kitchen_owner") setKitchenOpen(true);
      })
      .catch(() => {});
  }, []);

  // Online / offline listener
  useEffect(() => {
    const setOnline  = () => dispatch({ type: "SET_OFFLINE", payload: false });
    const setOffline = () => dispatch({ type: "SET_OFFLINE", payload: true });
    window.addEventListener("online", setOnline);
    window.addEventListener("offline", setOffline);
    return () => {
      window.removeEventListener("online", setOnline);
      window.removeEventListener("offline", setOffline);
    };
  }, []);

  // Push notification prompt
  useEffect(() => {
    if (user && "Notification" in window && Notification.permission === "default") {
      const alreadyAsked = localStorage.getItem("truehomes_push_subscribed");
      if (!alreadyAsked) setShowPushPrompt(true);
    }
  }, [user]);

  // Ctrl+K shortcut → open kitchen portal
  useEffect(() => {
    if (user?.role !== "kitchen_owner") return;
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setKitchenOpen(true);
        setAccountOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [user]);

  // Load kitchen data when portal opens
  useEffect(() => {
    if (!kitchenOpen || !["kitchen_owner", "admin"].includes(user?.role)) return;
    api("/api/kitchen/my").then(setMyKitchen).catch((e) => toast(e.message));
    api("/api/kitchen/my/orders").then(setKitchenOrders).catch(() => {});
  }, [kitchenOpen, user?.role]);

  // Load wallet when user logs in
  useEffect(() => {
    if (!user) return;
    api("/api/user/wallet").then(setWalletData).catch(() => {});
  }, [user]);

  // Chat streaming
  useEffect(() => {
    if (!chatOrderCode) return;
    api(`/api/orders/${chatOrderCode}/chat`).then(setChatMessages).catch((e) => toast(e.message));
    const controller = new AbortController();
    chatAbortRef.current = controller;

    async function streamChat() {
      try {
        const token = localStorage.getItem("truehomes_token");
        const res = await fetch(`/api/orders/${chatOrderCode}/chat/stream?token=${encodeURIComponent(token || "")}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            const line = part.trim();
            if (line.startsWith("data: ")) {
              try {
                const msg = JSON.parse(line.slice(6));
                setChatMessages((prev) => [...prev, msg]);
              } catch (_) {}
            }
          }
        }
      } catch (_) {}
    }
    streamChat();
    return () => controller.abort();
  }, [chatOrderCode]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const addItem = useCallback((restaurant, dish) => {
    dispatch({ type: "ADD_TO_CART", payload: { dish, restaurant } });
  }, [dispatch]);

  const toggleFavorite = useCallback((id) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem("truehomes_favs", JSON.stringify([...next]));
      return next;
    });
  }, []);

  const logout = useCallback(async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch (_) {}
    localStorage.removeItem("truehomes_token");
    dispatch({ type: "CLEAR_USER" });
    dispatch({ type: "CLEAR_CART" });
    setAccountOpen(false);
    setAdminOpen(false);
    setDeliveryOpen(false);
    setCustomerOrdersOpen(false);
    toast("Signed out");
  }, [dispatch, toast]);

  const toggleKitchenDuty = useCallback(async () => {
    try {
      const data = await api("/api/kitchen/my/toggle", { method: "PATCH" });
      setMyKitchen((prev) => prev ? { ...prev, isOpen: data.isOpen } : prev);
      toast(`Kitchen is now ${data.isOpen ? "OPEN (Accepting Orders)" : "CLOSED"}`);
    } catch (err) { toast(err.message); }
  }, [toast]);

  const toggleDishStock = useCallback(async (dishId) => {
    try {
      const updatedDish = await api(`/api/kitchen/my/menu/${dishId}/toggle`, { method: "PATCH" });
      setMyKitchen((prev) => prev ? {
        ...prev,
        menu: prev.menu.map((d) => d._id === dishId ? { ...d, isAvailable: updatedDish.isAvailable } : d),
      } : prev);
      toast(`${updatedDish.name} marked ${updatedDish.isAvailable !== false ? "In Stock" : "Out of Stock"}`);
    } catch (err) { toast(err.message); }
  }, [toast]);

  const sendChatMessage = useCallback(async () => {
    if (!chatInput.trim() || !chatOrderCode) return;
    const textToSend = chatInput.trim();
    setChatInput("");
    try {
      const msg = await api(`/api/orders/${chatOrderCode}/chat`, {
        method: "POST",
        body: JSON.stringify({ text: textToSend }),
      });
      setChatMessages((prev) => [...prev, msg]);
    } catch (err) { toast(err.message); }
  }, [chatInput, chatOrderCode, toast]);

  const requestPushSubscription = useCallback(async () => {
    try {
      setShowPushPrompt(false);
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        toast("Push notifications not supported on this browser");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { toast("Notification permission was not granted"); return; }
      const vapidRes = await api("/api/push/vapid-public-key");
      if (!vapidRes.publicKey) return;
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidRes.publicKey,
      });
      await api("/api/user/push-subscribe", { method: "POST", body: JSON.stringify({ subscription: sub }) });
      localStorage.setItem("truehomes_push_subscribed", "true");
      toast("🔔 Push notifications activated!");
    } catch (err) { toast(`Push setup: ${err.message}`); }
  }, [toast]);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="app">
      {/* Offline banner */}
      {isOffline && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            background: "#fef3c7", color: "#92400e",
            textAlign: "center", padding: "10px",
            fontWeight: 700, fontSize: 14,
          }}
        >
          ⚠️ You are offline. Some features may not be available.
        </div>
      )}

      {/* Push prompt banner */}
      {showPushPrompt && (
        <div
          role="banner"
          aria-label="Enable push notifications banner"
          style={{
            background: "#eff6ff", color: "#1d4ed8",
            padding: "10px 20px", textAlign: "center",
            display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap",
          }}
        >
          <span>🔔 Get real-time delivery updates via push notifications</span>
          <button
            onClick={requestPushSubscription}
            aria-label="Enable Push Notifications"
            style={{ background: "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontWeight: 700 }}
          >
            Enable Push
          </button>
          <button
            onClick={() => setShowPushPrompt(false)}
            aria-label="Dismiss push notifications prompt"
            style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Top navigation */}
      <TopBar
        search={search}
        onSearchChange={setSearch}
        cart={cart}
        user={user}
        accountOpen={accountOpen}
        onCartClick={() => setCartOpen(true)}
        onAuthClick={() => setAuthOpen(true)}
        onAccountToggle={() => setAccountOpen((v) => !v)}
        onTrackerClick={() => setTrackerOpen(true)}
        onKitchenClick={() => { setKitchenOpen(true); setAccountOpen(false); }}
        onAdminClick={() => { setAdminOpen(true); setAccountOpen(false); }}
        onDeliveryClick={() => { setDeliveryOpen(true); setAccountOpen(false); }}
        onOrdersClick={() => { setCustomerOrdersOpen(true); setAccountOpen(false); }}
        onLogout={logout}
        walletBalance={walletData.balance}
      />

      {/* Main restaurant listing */}
      <main>
        <div className="hero" role="banner" aria-label="Welcome banner">
          <div>
            <p>Homestyle &amp; Top Rated</p>
            <h1>Food Delivered<br />To Your Door</h1>
          </div>
          <div className="offer" aria-label="Offer: Up to 50% off">
            <div style={{ textAlign: "center", lineHeight: 1.3 }}>
              <strong>Up to</strong><br />
              <span style={{ fontSize: 28 }}>50%</span><br />
              <strong>OFF</strong>
            </div>
          </div>
        </div>

        <RestaurantList
          restaurants={restaurants}
          cuisineFilter={cuisineFilter}
          globalVegOnly={globalVegOnly}
          favorites={favorites}
          onCuisineChange={setCuisineFilter}
          onVegToggle={() => setGlobalVegOnly((v) => !v)}
          onFavoriteToggle={toggleFavorite}
          onAddItem={addItem}
          onOpenMenu={() => {}} // placeholder – wire up full menu modal from main.jsx
        />
      </main>

      {/* Toast notifications */}
      <Toast />

      {/* Lazy-loaded modals */}
      <Suspense fallback={<ModalFallback />}>
        {chatOrderCode && (
          <ChatModal
            orderCode={chatOrderCode}
            messages={chatMessages}
            inputValue={chatInput}
            onInputChange={setChatInput}
            onSend={sendChatMessage}
            onClose={() => { setChatOrderCode(null); chatAbortRef.current?.abort(); }}
          />
        )}

        {kitchenOpen && (
          <KitchenPortal
            kitchen={myKitchen}
            orders={kitchenOrders}
            activeTab={kitchenTab}
            onTabChange={setKitchenTab}
            onToggleDuty={toggleKitchenDuty}
            onToggleDish={toggleDishStock}
            onOpenChat={(code) => { setChatOrderCode(code); }}
            onClose={() => setKitchenOpen(false)}
          />
        )}
      </Suspense>
    </div>
  );
}

// ─── Root entry point ─────────────────────────────────────────────────────────
function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);
