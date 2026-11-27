import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// Web Audio synthesizer chime for status updates & notifications
function playOrderChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.setValueAtTime(880, now + 0.12); // A5

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.35);
  } catch (_) {}
}

function sendWebNotification(title, body) {
  playOrderChime();
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      // In mobile Chrome / Android PWA, new Notification() throws 'Illegal constructor'.
      // The standard and cross-platform way is serviceWorkerRegistration.showNotification()
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready
          .then((reg) => reg.showNotification(title, { body, icon: "/favicon.ico", badge: "/favicon.ico" }))
          .catch(() => {
            try { new Notification(title, { body, icon: "/favicon.ico" }); } catch (_) {}
          });
      } else {
        try { new Notification(title, { body, icon: "/favicon.ico" }); } catch (_) {}
      }
    }
  } catch (_) {}
}

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // distance in km
}

function LiveDeliveryMap({ order }) {
  const location = order?.deliveryLocation;
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return <p className="muted">Delivery partner GPS has not been shared yet.</p>;
  }

  // Base destination coords (Indirapuram, Ghaziabad hub reference: 28.6327° N, 77.3653° E)
  const destLat = 28.6327;
  const destLon = 77.3653;
  const distanceKm = calculateHaversineDistance(latitude, longitude, destLat, destLon);
  const estMins = Math.max(3, Math.round(distanceKm * 3.5)); // estimated bike transit time

  const offset = 0.006;
  const bounds = [
    longitude - offset,
    latitude - offset,
    longitude + offset,
    latitude + offset,
  ].join("%2C");
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bounds}&layer=mapnik&marker=${latitude}%2C${longitude}`;
  const mapLink = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`;
  const updatedAt = location.updatedAt
    ? new Date(location.updatedAt).toLocaleTimeString()
    : "recently";

  return (
    <div className="delivery-location">
      <div className="rider-eta-banner">
        <span>🛵 Rider is <b>{distanceKm.toFixed(1)} km</b> away</span>
        <span>Estimated arrival: <b>~{estMins} mins</b></span>
      </div>
      <iframe title={`Delivery partner location for ${order.orderCode}`} src={mapUrl} loading="lazy" />
      <p>Last GPS update: {updatedAt} · <a href={mapLink} target="_blank" rel="noreferrer">Open map</a></p>
    </div>
  );
}

async function followOrder(orderCode, signal, onOrder) {
  const token = localStorage.getItem("truehomes_token");
  const response = await fetch(`/api/orders/${encodeURIComponent(orderCode)}/stream`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Could not connect to live order updates");
  }
  if (!response.body) throw new Error("Live order updates are unavailable");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (data) onOrder(JSON.parse(data));
    }
  }
}

async function api(path, options = {}) {
  const token = localStorage.getItem("truehomes_token");
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "include",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function App() {
  const [restaurants, setRestaurants] = useState([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authRole, setAuthRole] = useState("customer");
  const [user, setUser] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [customerOrdersOpen, setCustomerOrdersOpen] = useState(false);
  const [customerOrders, setCustomerOrders] = useState([]);
  const [customerOrdersError, setCustomerOrdersError] = useState("");
  const [partnerOrders, setPartnerOrders] = useState([]);
  const [partnerOrdersError, setPartnerOrdersError] = useState("");
  const [partnerApplications, setPartnerApplications] = useState([]);
  const [partnerApplicationsError, setPartnerApplicationsError] = useState("");
  const [sharingOrderId, setSharingOrderId] = useState("");
  const [locationError, setLocationError] = useState("");
  const [adminOrders, setAdminOrders] = useState([]);
  const [adminStreamStatus, setAdminStreamStatus] = useState("offline");
  const [adminStreamError, setAdminStreamError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewModalOrder, setReviewModalOrder] = useState(null);
  const [foodRating, setFoodRating] = useState(5);
  const [deliveryRating, setDeliveryRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewedOrders, setReviewedOrders] = useState(new Set());
  const [viewingRestaurantReviews, setViewingRestaurantReviews] = useState(null);
  const [restaurantReviewsList, setRestaurantReviewsList] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  // New States: Full Categorized Menu View
  const [activeMenuRestaurant, setActiveMenuRestaurant] = useState(null);
  const [menuSearch, setMenuSearch] = useState("");
  const [menuVegOnly, setMenuVegOnly] = useState(false);

  // New States: Promo Coupons
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponError, setCouponError] = useState("");

  // New States: Standalone Order Tracker by Code
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [trackerCodeInput, setTrackerCodeInput] = useState("");
  const [trackedOrder, setTrackedOrder] = useState(null);
  const [trackerError, setTrackerError] = useState("");
  const [trackerConnecting, setTrackerConnecting] = useState(false);
  const trackerAbortRef = useRef(null);

  // New States: Tip, Address, Payment Method, and Favorites
  const [riderTip, setRiderTip] = useState(0);
  const [selectedAddress, setSelectedAddress] = useState("Indirapuram, Ghaziabad");
  const [newAddressInput, setNewAddressInput] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("COD");
  const [invoiceOrder, setInvoiceOrder] = useState(null);
  const [favorites, setFavorites] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("truehomes_favs") || "[]"));
    } catch (_) {
      return new Set();
    }
  });

  // New States: Cuisine & Dietary Filter Pills
  const [selectedCuisineFilter, setSelectedCuisineFilter] = useState("All");
  const [globalVegOnly, setGlobalVegOnly] = useState(false);

  // New States: Profile & Address Manager Modal (Swiggy/Zomato/Zepto-style)
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileActiveTab, setProfileActiveTab] = useState("overview"); // overview, edit, addresses, preferences
  const [profileNameInput, setProfileNameInput] = useState("");
  const [profilePhoneInput, setProfilePhoneInput] = useState("");
  const [profileAvatarInput, setProfileAvatarInput] = useState("");
  const [profileBioInput, setProfileBioInput] = useState("");
  const [profileDietaryInput, setProfileDietaryInput] = useState("all");
  const [profileDobInput, setProfileDobInput] = useState("");
  const [profileGenderInput, setProfileGenderInput] = useState("prefer_not_to_say");
  const [profileAddrLabel, setProfileAddrLabel] = useState("Home");
  const [profileAddrText, setProfileAddrText] = useState("");
  const [editingAddrId, setEditingAddrId] = useState(null);
  const [editAddrLabel, setEditAddrLabel] = useState("Home");
  const [editAddrText, setEditAddrText] = useState("");

  // New States: Admin Dashboard Tabs & Forms
  const [adminActiveTab, setAdminActiveTab] = useState("orders"); // "orders", "applications", "add-kitchen", "add-dish", "coupons", "analytics"
  const [adminAnalytics, setAdminAnalytics] = useState(null);
  const [riderDeliveryOtp, setRiderDeliveryOtp] = useState({});
  const [newKitchenName, setNewKitchenName] = useState("");
  const [newKitchenCuisines, setNewKitchenCuisines] = useState("");
  const [newKitchenTime, setNewKitchenTime] = useState(30);
  const [newKitchenCost, setNewKitchenCost] = useState(350);
  const [newKitchenLocation, setNewKitchenLocation] = useState("Indirapuram, Ghaziabad");
  const [newKitchenImage, setNewKitchenImage] = useState("");

  const [dishTargetRestaurantId, setDishTargetRestaurantId] = useState("");
  const [newDishName, setNewDishName] = useState("");
  const [newDishPrice, setNewDishPrice] = useState(180);
  const [newDishCategory, setNewDishCategory] = useState("Mains");
  const [newDishIsVeg, setNewDishIsVeg] = useState(true);
  const [newDishIsBestseller, setNewDishIsBestseller] = useState(false);
  const [newDishDesc, setNewDishDesc] = useState("");

  // New States: Admin Coupon Creator
  const [adminCouponsList, setAdminCouponsList] = useState([]);
  const [newCouponCode, setNewCouponCode] = useState("");
  const [newCouponDiscount, setNewCouponDiscount] = useState(30);
  const [newCouponMaxDisc, setNewCouponMaxDisc] = useState(150);
  const [newCouponMinOrder, setNewCouponMinOrder] = useState(199);
  const [newCouponFreeDel, setNewCouponFreeDel] = useState(false);
  const [newCouponDesc, setNewCouponDesc] = useState("");

  // Feature 1: Kitchen Owner Portal States
  const [kitchenOpen, setKitchenOpen] = useState(false);
  const [myKitchen, setMyKitchen] = useState(null);
  const [kitchenOrders, setKitchenOrders] = useState([]);
  const [kitchenTab, setKitchenTab] = useState("orders"); // "orders", "menu", "reviews"
  const [kitchenReviews, setKitchenReviews] = useState([]);
  const [deliveryReviews, setDeliveryReviews] = useState([]);
  const [adminReviews, setAdminReviews] = useState([]);

  // Feature 2: Live In-App Chat States
  const [chatOrderCode, setChatOrderCode] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const chatAbortRef = useRef(null);

  // Feature 3: Customer Wallet, Cashback & Referral States
  const [walletData, setWalletData] = useState({ balance: 0, transactions: [] });
  const [referralData, setReferralData] = useState({ referralCode: "", referralCount: 0 });
  const [useWalletBalance, setUseWalletBalance] = useState(false);

  // Feature 4: PWA Web Push & Offline States
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);

  const locationWatchId = useRef(null);
  const lastLocationSentAt = useRef(0);

  useEffect(() => {
    api(`/api/restaurants?search=${encodeURIComponent(search)}`)
      .then(setRestaurants)
      .catch(() => setNotice("Unable to load kitchens"));
  }, [search]);

  useEffect(() => {
    const token = localStorage.getItem("truehomes_token");
    if (token) {
      api("/api/auth/me")
        .then((restoredUser) => {
          setUser(restoredUser);
          if (restoredUser.role === "admin") setAdminOpen(true);
          if (restoredUser.role === "delivery_partner") setDeliveryOpen(true);
          if (restoredUser.role === "kitchen_owner") setKitchenOpen(true);
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Support PWA shortcuts and direct URLs (e.g. /?action=track, /?action=cart, /?action=profile)
    try {
      const params = new URLSearchParams(window.location.search);
      const action = params.get("action");
      if (action === "track") setTrackerOpen(true);
      else if (action === "cart") setCartOpen(true);
      else if (action === "profile") setProfileOpen(true);
    } catch (_) {}

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (user && "Notification" in window && Notification.permission === "default") {
      const alreadyAsked = localStorage.getItem("truehomes_push_subscribed");
      if (!alreadyAsked) setShowPushPrompt(true);
    }
  }, [user]);

  useEffect(() => {
    if (!kitchenOpen || (user?.role !== "kitchen_owner" && user?.role !== "admin")) return;
    api("/api/kitchen/my")
      .then(setMyKitchen)
      .catch((err) => setNotice(err.message));
    api("/api/kitchen/my/orders")
      .then(setKitchenOrders)
      .catch(() => {});
    api("/api/kitchen/my/reviews")
      .then(setKitchenReviews)
      .catch(() => {});
  }, [kitchenOpen, user?.role]);

  useEffect(() => {
    if (!user) return;
    api("/api/user/wallet")
      .then(setWalletData)
      .catch(() => {});
    api("/api/user/referral")
      .then(setReferralData)
      .catch(() => {});
  }, [user, profileOpen, accountOpen, cartOpen]);

  useEffect(() => {
    if (!chatOrderCode) return;
    api(`/api/orders/${chatOrderCode}/chat`)
      .then(setChatMessages)
      .catch((err) => setNotice(err.message));

    const controller = new AbortController();
    chatAbortRef.current = controller;

    async function streamChat() {
      try {
        const token = localStorage.getItem("truehomes_token");
        const res = await fetch(`/api/orders/${chatOrderCode}/chat/stream?token=${encodeURIComponent(token || "")}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal
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
                playOrderChime();
              } catch (_) {}
            }
          }
        }
      } catch (_) {}
    }

    streamChat();
    return () => {
      controller.abort();
    };
  }, [chatOrderCode]);

  useEffect(() => {
    if (!adminOpen || user?.role !== "admin") return;
    api("/api/admin/delivery-partners/pending")
      .then(setPartnerApplications)
      .catch((error) => setPartnerApplicationsError(error.message));
    api("/api/coupons/active")
      .then(setAdminCouponsList)
      .catch(() => {});
    api("/api/admin/reviews")
      .then(setAdminReviews)
      .catch(() => {});
  }, [adminOpen, user?.role]);

  useEffect(() => {
    if (!deliveryOpen || user?.role !== "delivery_partner") {
      setPartnerOrdersError("");
      return;
    }

    api("/api/delivery/reviews")
      .then(setDeliveryReviews)
      .catch(() => {});

    let active = true;
    let refreshTimer;
    async function refreshPartnerOrders() {
      try {
        const orders = await api("/api/delivery/orders");
        if (active) {
          setPartnerOrders(orders);
          setPartnerOrdersError("");
        }
      } catch (error) {
        if (active) setPartnerOrdersError(error.message);
      }
    }
    refreshPartnerOrders();
    refreshTimer = setInterval(refreshPartnerOrders, 5000);
    return () => {
      active = false;
      clearInterval(refreshTimer);
    };
  }, [deliveryOpen, user?.id, user?.role]);

  useEffect(() => {
    if (!customerOrdersOpen || user?.role !== "customer") return;
    let active = true;
    let refreshTimer;
    const streams = new Map();
    const updateOrder = (order) => {
      if (!order?._id) return;
      setCustomerOrders((current) => {
        const exists = current.some((item) => String(item._id) === String(order._id));
        return exists
          ? current.map((item) => String(item._id) === String(order._id) ? order : item)
          : [order, ...current];
      });
    };
    async function refreshCustomerOrders() {
      try {
        const orders = await api("/api/orders/my");
        if (!active) return;
        setCustomerOrders(orders);
        setCustomerOrdersError("");
        for (const order of orders) {
          if (!streams.has(order.orderCode)) {
            const controller = new AbortController();
            streams.set(order.orderCode, controller);
            followOrder(order.orderCode, controller.signal, updateOrder)
              .catch((error) => {
                if (active && !controller.signal.aborted) {
                  setCustomerOrdersError(error.message);
                }
              });
          }
        }
      } catch (error) {
        if (active) setCustomerOrdersError(error.message);
      }
    }
    refreshCustomerOrders();
    refreshTimer = setInterval(refreshCustomerOrders, 10000);
    return () => {
      active = false;
      clearInterval(refreshTimer);
      streams.forEach((controller) => controller.abort());
    };
  }, [customerOrdersOpen, user?.id, user?.role]);

  useEffect(() => () => {
    if (locationWatchId.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(locationWatchId.current);
    }
  }, []);

  useEffect(() => {
    if (!adminOpen || user?.role !== "admin") {
      setAdminStreamStatus("offline");
      return;
    }

    const controller = new AbortController();
    let retryTimer;
    let hasConnected = false;

    async function connectToAdminOrderStream() {
      while (!controller.signal.aborted) {
        setAdminStreamStatus(hasConnected ? "reconnecting" : "connecting");

        try {
          const token = localStorage.getItem("truehomes_token");
          const response = await fetch("/api/admin/orders/stream", {
            headers: { Authorization: `Bearer ${token}` },
            credentials: "include",
            signal: controller.signal,
          });

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            const error = new Error(data.error || "Could not connect to live orders");
            error.status = response.status;
            throw error;
          }
          if (!response.body) throw new Error("Live order stream is unavailable");

          hasConnected = true;
          setAdminStreamStatus("live");
          setAdminStreamError("");

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (!controller.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split(/\r?\n\r?\n/);
            buffer = frames.pop() || "";

            for (const frame of frames) {
              const data = frame
                .split(/\r?\n/)
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trim())
                .join("\n");
              if (!data) continue;

              const event = JSON.parse(data);
              if (event.type === "snapshot" && Array.isArray(event.orders)) {
                setAdminOrders(event.orders);
              } else if (event.type === "order" && event.order?._id) {
                setAdminOrders((current) => {
                  const existingIndex = current.findIndex(
                    (order) => String(order._id) === String(event.order._id),
                  );
                  const updated =
                    existingIndex >= 0
                      ? current.map((order, index) =>
                          index === existingIndex ? event.order : order,
                        )
                      : [event.order, ...current];
                  return updated
                    .sort(
                      (a, b) =>
                        new Date(b.createdAt || 0).getTime() -
                        new Date(a.createdAt || 0).getTime(),
                    );
                });
              } else {
                throw new Error("Received an invalid live order event");
              }
            }
          }

          if (!controller.signal.aborted) {
            setAdminStreamStatus("reconnecting");
            setAdminStreamError("Live connection closed. Reconnecting…");
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error.status === 401 || error.status === 403) {
            setAdminStreamStatus("error");
            setAdminStreamError(error.message);
            return;
          }
          setAdminStreamStatus("reconnecting");
          setAdminStreamError(error.message || "Live order connection failed");
        }

        await new Promise((resolve) => {
          retryTimer = setTimeout(resolve, 2000);
        });
      }
    }

    connectToAdminOrderStream();
    return () => {
      controller.abort();
      clearTimeout(retryTimer);
    };
  }, [adminOpen, user?.id, user?.role]);

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.qty, 0),
    [cart]
  );

  const deliveryFee = useMemo(() => {
    if (appliedCoupon?.isFreeDelivery) return 0;
    return subtotal >= 299 ? 0 : 35;
  }, [subtotal, appliedCoupon]);

  const discount = useMemo(() => {
    if (!appliedCoupon) return 0;
    return appliedCoupon.discount || 0;
  }, [appliedCoupon]);

  const walletAvailable = user?.walletBalance || walletData.balance || 0;
  const baseOrderTotal = useMemo(() => {
    return Math.max(0, subtotal - discount + deliveryFee + riderTip);
  }, [subtotal, discount, deliveryFee, riderTip]);

  const walletDeduction = useMemo(() => {
    if (!useWalletBalance || walletAvailable <= 0) return 0;
    return Math.min(walletAvailable, baseOrderTotal);
  }, [useWalletBalance, walletAvailable, baseOrderTotal]);

  const finalTotal = useMemo(() => {
    return Math.max(0, baseOrderTotal - walletDeduction);
  }, [baseOrderTotal, walletDeduction]);

  async function toggleKitchenDuty() {
    try {
      const data = await api("/api/kitchen/my/toggle", { method: "PATCH" });
      setMyKitchen((prev) => prev ? { ...prev, isOpen: data.isOpen } : prev);
      setNotice(`Kitchen is now ${data.isOpen ? "OPEN (Accepting Orders)" : "CLOSED"}`);
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function toggleDishStock(dishId) {
    try {
      const updatedDish = await api(`/api/kitchen/my/menu/${dishId}/toggle`, { method: "PATCH" });
      setMyKitchen((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          menu: prev.menu.map((d) => d._id === dishId ? { ...d, isAvailable: updatedDish.isAvailable } : d)
        };
      });
      setNotice(`${updatedDish.name} marked ${updatedDish.isAvailable !== false ? "In Stock" : "Out of Stock"}`);
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function sendChatMessage(e) {
    e.preventDefault();
    if (!chatInput.trim() || !chatOrderCode) return;
    const textToSend = chatInput.trim();
    setChatInput("");
    try {
      const msg = await api(`/api/orders/${chatOrderCode}/chat`, {
        method: "POST",
        body: JSON.stringify({ text: textToSend })
      });
      setChatMessages((prev) => [...prev, msg]);
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function requestPushSubscription() {
    try {
      setShowPushPrompt(false);
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setNotice("Push notifications not supported on this browser");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setNotice("Notification permission was not granted");
        return;
      }
      const vapidRes = await api("/api/push/vapid-public-key");
      if (!vapidRes.publicKey) return;

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidRes.publicKey
      });
      await api("/api/user/push-subscribe", {
        method: "POST",
        body: JSON.stringify({ subscription: sub })
      });
      localStorage.setItem("truehomes_push_subscribed", "true");
      setPushSubscribed(true);
      setNotice("🔔 Push notifications activated! You will receive live delivery updates.");
    } catch (err) {
      setNotice(`Push setup: ${err.message}`);
    }
  }

  function toggleFavorite(id) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem("truehomes_favs", JSON.stringify([...next]));
      return next;
    });
  }

  function reorderItems(order) {
    if (!order?.items || !order.restaurantId) return;
    const itemsToAdd = order.items.map((it) => ({
      _id: it.menuItemId,
      name: it.name,
      price: it.unitPrice || 150,
      qty: it.qty || 1,
      restaurantId: order.restaurantId,
      restaurantName: order.restaurantName
    }));
    setCart(itemsToAdd);
    setCustomerOrdersOpen(false);
    setCartOpen(true);
    setNotice(`Added items from order ${order.orderCode} to cart`);
    playOrderChime();
  }

  async function saveNewAddress() {
    if (!newAddressInput.trim()) return;
    try {
      const res = await api("/api/user/addresses", {
        method: "POST",
        body: JSON.stringify({ label: "Custom", address: newAddressInput.trim() })
      });
      setUser((u) => u ? { ...u, addresses: res.addresses } : u);
      setSelectedAddress(newAddressInput.trim());
      setNewAddressInput("");
      setNotice("Address saved successfully");
    } catch (err) {
      setNotice(err.message || "Failed to save address");
    }
  }

  async function applyCoupon() {
    if (!couponInput.trim()) return;
    setCouponError("");
    try {
      const result = await api("/api/coupons/validate", {
        method: "POST",
        body: JSON.stringify({
          code: couponInput.trim().toUpperCase(),
          itemTotal: subtotal,
        }),
      });
      setAppliedCoupon(result);
      setNotice(`Applied coupon ${result.code}: ₹${result.discount} OFF`);
    } catch (err) {
      setCouponError(err.message || "Invalid coupon");
    }
  }

  function removeCoupon() {
    setAppliedCoupon(null);
    setCouponInput("");
    setCouponError("");
  }

  async function updateProfile(e) {
    if (e) e.preventDefault();
    try {
      const updated = await api("/api/user/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: profileNameInput.trim() || undefined,
          phone: profilePhoneInput.trim() || undefined,
          avatar: profileAvatarInput.trim(),
          bio: profileBioInput.trim(),
          dietaryPreference: profileDietaryInput,
          dateOfBirth: profileDobInput.trim(),
          gender: profileGenderInput
        })
      });
      setUser((prev) => ({ ...prev, ...updated }));
      setNotice("Profile updated successfully!");
      setProfileActiveTab("overview");
    } catch (err) {
      setNotice(err.message || "Failed to update profile");
    }
  }

  async function addProfileAddress(e) {
    e.preventDefault();
    if (!profileAddrText.trim()) return;
    try {
      const res = await api("/api/user/addresses", {
        method: "POST",
        body: JSON.stringify({
          label: profileAddrLabel,
          address: profileAddrText.trim()
        })
      });
      setUser((prev) => ({ ...prev, addresses: res.addresses }));
      setProfileAddrText("");
      setNotice("Address added!");
    } catch (err) {
      setNotice(err.message || "Failed to add address");
    }
  }

  async function saveEditedAddress(e) {
    e.preventDefault();
    if (!editAddrText.trim() || !editingAddrId) return;
    try {
      const res = await api(`/api/user/addresses/${editingAddrId}`, {
        method: "PUT",
        body: JSON.stringify({
          label: editAddrLabel,
          address: editAddrText.trim()
        })
      });
      setUser((prev) => ({ ...prev, addresses: res.addresses }));
      setEditingAddrId(null);
      setNotice("Address updated successfully!");
    } catch (err) {
      setNotice(err.message || "Failed to update address");
    }
  }

  async function deleteProfileAddress(addressId) {
    try {
      const res = await api(`/api/user/addresses/${addressId}`, {
        method: "DELETE"
      });
      setUser((prev) => ({ ...prev, addresses: res.addresses }));
      setNotice("Address deleted");
    } catch (err) {
      setNotice(err.message || "Failed to delete address");
    }
  }

  async function toggleRiderAvailability() {
    try {
      const res = await api("/api/delivery/availability", {
        method: "PATCH",
        body: JSON.stringify({ isAvailable: !user?.isAvailable })
      });
      setUser((prev) => ({ ...prev, isAvailable: res.isAvailable }));
      setNotice(`You are now ${res.isAvailable ? "Online (Receiving orders)" : "Offline (Duty paused)"}`);
    } catch (err) {
      setNotice(err.message || "Failed to toggle duty availability");
    }
  }

  async function lookupTrackOrder(e) {
    if (e) e.preventDefault();
    const code = trackerCodeInput.trim().toUpperCase();
    if (!code) return;
    setTrackerError("");
    setTrackerConnecting(true);

    if (trackerAbortRef.current) {
      trackerAbortRef.current.abort();
    }
    const controller = new AbortController();
    trackerAbortRef.current = controller;

    try {
      const order = await api(`/api/orders/${encodeURIComponent(code)}`);
      setTrackedOrder(order);
      setTrackerConnecting(false);

      // Connect to SSE live stream for this order
      followOrder(code, controller.signal, (updated) => {
        setTrackedOrder(updated);
        sendWebNotification(
          `Order ${updated.orderCode} update`,
          `Status is now: ${updated.status}`
        );
      }).catch((err) => {
        if (!controller.signal.aborted) {
          setTrackerError(err.message || "Live stream disconnected");
        }
      });
    } catch (err) {
      setTrackerConnecting(false);
      setTrackerError(err.message || "Order not found. Please log in if this is your order.");
    }
  }

  function addItem(restaurant, dish) {
    setCart((current) => {
      const existing = current.find((item) => item._id === dish._id);
      if (existing) {
        return current.map((item) =>
          item._id === dish._id ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [
        ...current,
        {
          ...dish,
          qty: 1,
          restaurantId: restaurant._id,
          restaurantName: restaurant.name,
        },
      ];
    });
  }

  function updateCartItemQty(dishId, delta) {
    setCart((current) => {
      return current
        .map((item) => {
          if (item._id === dishId) {
            const nextQty = item.qty + delta;
            return nextQty > 0 ? { ...item, qty: nextQty } : null;
          }
          return item;
        })
        .filter(Boolean);
    });
  }

  function clearCart() {
    setCart([]);
    setAppliedCoupon(null);
    setRiderTip(0);
  }

  async function login(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const endpoint =
        authMode === "register"
          ? "/api/auth/register"
          : "/api/auth/login";
      const payload = authMode === "register"
        ? {
            name: form.get("name"),
            email: form.get("email"),
            phone: form.get("phone"),
            password: form.get("password"),
            role: authRole,
            referralCode: form.get("referralCode") || undefined
          }
        : {
            email: form.get("email"),
            password: form.get("password"),
            role: authRole,
          };
      const data = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (data.pendingApproval) {
        setAuthOpen(false);
        setNotice(data.message);
        return;
      }
      if (data.user.role !== authRole) {
        throw new Error(
          `This account is registered as ${String(data.user.role).replace("_", " ")}. Choose that login option.`,
        );
      }
      localStorage.setItem("truehomes_token", data.token);
      setUser(data.user);
      setAdminOpen(data.user.role === "admin");
      setDeliveryOpen(data.user.role === "delivery_partner");
      setKitchenOpen(data.user.role === "kitchen_owner");
      setCustomerOrdersOpen(false);
      setAuthOpen(false);
      setNotice(
        authMode === "register"
          ? `Account created, welcome ${data.user.name}`
          : `Welcome, ${data.user.name}`
      );
    } catch (error) {
      setNotice(
        authMode === "login" && /invalid email or password/i.test(error.message)
          ? "Invalid email or password. Register if you do not have an account."
          : error.message
      );
    }
  }

  async function checkout() {
    if (!cart.length) return;
    try {
      const restaurantId = cart[0].restaurantId;
      const order = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          restaurantId,
          items: cart.map((item) => ({ menuItemId: item._id, qty: item.qty })),
          couponCode: appliedCoupon?.code || undefined,
          tip: riderTip,
          paymentMethod,
          walletAmountToUse: useWalletBalance && walletDeduction > 0 ? walletDeduction : undefined,
          customerName: user?.name || "React Customer",
          customerPhone: user?.phone || "9876543210",
          deliveryAddress: selectedAddress,
        }),
      });

      api("/api/auth/me").then(setUser).catch(() => {});
      api("/api/user/wallet").then(setWalletData).catch(() => {});

      if (paymentMethod === "RAZORPAY") {
        // Initiate Razorpay flow
        const initData = await api("/api/payments/razorpay/order", {
          method: "POST",
          body: JSON.stringify({ orderId: order._id, orderCode: order.orderCode })
        });

        if (initData.mode === "simulator") {
          // Simulator auto-verify
          await api("/api/payments/razorpay/verify", {
            method: "POST",
            body: JSON.stringify({
              orderId: order._id,
              orderCode: order.orderCode,
              simulated: true
            })
          });
          setNotice(`Payment simulated & Order ${order.orderCode} confirmed!`);
        } else if (window.Razorpay && initData.razorpayOrderId) {
          const options = {
            key: initData.keyId,
            amount: initData.amount,
            currency: initData.currency,
            name: "TrueHomes Delivery",
            description: `Order ${order.orderCode}`,
            order_id: initData.razorpayOrderId,
            handler: async function (response) {
              try {
                await api("/api/payments/razorpay/verify", {
                  method: "POST",
                  body: JSON.stringify({
                    orderId: order._id,
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature
                  })
                });
                setNotice(`Payment verified! Order ${order.orderCode} placed.`);
              } catch (_) {
                setNotice("Payment verification failed");
              }
            },
            prefill: {
              name: user?.name || "TrueHomes Customer",
              email: user?.email || "",
              contact: user?.phone || ""
            },
            theme: { color: "#ea580c" }
          };
          const rzp = new window.Razorpay(options);
          rzp.open();
        }
      } else {
        setNotice(`Order ${order.orderCode} placed successfully (COD)`);
      }

      setCart([]);
      setAppliedCoupon(null);
      setRiderTip(0);
      setCartOpen(false);
      playOrderChime();
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function logout() {
    await stopLocationSharing();
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (_) {}
    localStorage.removeItem("truehomes_token");
    setUser(null);
    setAccountOpen(false);
    setAdminOpen(false);
    setDeliveryOpen(false);
    setCustomerOrdersOpen(false);
    setNotice("Signed out");
  }

  async function openAdminOrders() {
    setAccountOpen(false);
    setAdminOrders([]);
    setAdminStreamError("");
    setAdminOpen(true);
  }

  async function stopLocationSharing(clearRemote = true) {
    const orderId = sharingOrderId;
    if (locationWatchId.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(locationWatchId.current);
      locationWatchId.current = null;
    }
    setSharingOrderId("");
    if (clearRemote && orderId) {
      try {
        const updated = await api(`/api/delivery/orders/${orderId}/location`, { method: "DELETE" });
        setPartnerOrders((current) =>
          current.map((item) => String(item._id) === String(updated._id) ? updated : item),
        );
      } catch (error) {
        setLocationError(error.message);
      }
    }
  }

  function startLocationSharing(order) {
    if (!navigator.geolocation) {
      setLocationError("This browser does not support GPS location.");
      return;
    }
    stopLocationSharing();
    setLocationError("");
    setSharingOrderId(String(order._id));
    lastLocationSentAt.current = 0;
    try {
      locationWatchId.current = navigator.geolocation.watchPosition(
        async ({ coords }) => {
          if (Date.now() - lastLocationSentAt.current < 10000) return;
          lastLocationSentAt.current = Date.now();
          try {
            const updated = await api(`/api/delivery/orders/${order._id}/location`, {
              method: "PATCH",
              body: JSON.stringify({
                latitude: coords.latitude,
                longitude: coords.longitude,
              }),
            });
            setPartnerOrders((current) =>
              current.map((item) => String(item._id) === String(updated._id) ? updated : item),
            );
          } catch (error) {
            setLocationError(error.message);
            stopLocationSharing();
          }
        },
        (error) => {
          setLocationError(error.message || "GPS permission was not granted.");
          stopLocationSharing();
        },
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 },
      );
    } catch (error) {
      setLocationError(error.message || "Could not start GPS sharing.");
      stopLocationSharing();
    }
  }

  async function cancelCustomerOrder(order) {
    if (!window.confirm(`Are you sure you want to cancel order ${order.orderCode}?`)) return;
    try {
      const res = await api(`/api/orders/${order.orderCode}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: "Customer cancelled from orders modal" })
      });
      setCustomerOrders((current) =>
        current.map((item) => String(item._id) === String(order._id) ? res.order : item)
      );
      setNotice(`Order ${order.orderCode} has been cancelled.`);
    } catch (err) {
      setNotice(err.message || "Failed to cancel order");
    }
  }

  async function updateDeliveryStatus(order, status) {
    try {
      const payload = { status };
      if (status === "DELIVERED" && riderDeliveryOtp[order._id]) {
        payload.otp = riderDeliveryOtp[order._id].trim();
      }
      const updated = await api(`/api/delivery/orders/${order._id}/status`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setPartnerOrders((current) =>
        current.map((item) => String(item._id) === String(updated._id) ? updated : item),
      );
      if (status === "DELIVERED" && sharingOrderId === String(order._id)) {
        await stopLocationSharing(false);
      }
    } catch (error) {
      setPartnerOrdersError(error.message);
    }
  }

  async function claimDeliveryOrder(order) {
    try {
      await api(`/api/delivery/orders/${order._id}/claim`, { method: "PATCH" });
      const orders = await api("/api/delivery/orders");
      setPartnerOrders(orders);
      setPartnerOrdersError("");
    } catch (error) {
      setPartnerOrdersError(error.message);
    }
  }

  async function approvePartner(partnerId) {
    try {
      await api(`/api/admin/delivery-partners/${partnerId}/approve`, { method: "PATCH" });
      setPartnerApplications((current) =>
        current.filter((partner) => String(partner._id) !== String(partnerId)),
      );
      setPartnerApplicationsError("");
    } catch (error) {
      setPartnerApplicationsError(error.message);
    }
  }

  async function createRestaurant(e) {
    e.preventDefault();
    if (!newKitchenName.trim()) return;
    try {
      const payload = {
        name: newKitchenName.trim(),
        cuisines: newKitchenCuisines.split(",").map((c) => c.trim()).filter(Boolean),
        deliveryTime: Number(newKitchenTime) || 30,
        costForTwo: Number(newKitchenCost) || 350,
        location: newKitchenLocation.trim(),
        image: newKitchenImage.trim() || undefined,
      };
      await api("/api/admin/restaurants", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setNotice(`Kitchen "${newKitchenName}" created successfully!`);
      setNewKitchenName("");
      setNewKitchenCuisines("");
      setNewKitchenImage("");
      setAdminActiveTab("orders");
      // Refresh restaurant listing
      api(`/api/restaurants?search=${encodeURIComponent(search)}`).then(setRestaurants).catch(() => {});
    } catch (err) {
      setNotice(err.message || "Failed to create kitchen");
    }
  }

  async function createDish(e) {
    e.preventDefault();
    const restId = dishTargetRestaurantId || restaurants[0]?._id;
    if (!restId || !newDishName.trim()) return;
    try {
      const payload = {
        name: newDishName.trim(),
        price: Number(newDishPrice) || 150,
        category: newDishCategory.trim() || "Mains",
        isVeg: Boolean(newDishIsVeg),
        isBestseller: Boolean(newDishIsBestseller),
        description: newDishDesc.trim() || undefined,
      };
      await api(`/api/admin/restaurants/${restId}/menu`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setNotice(`Dish "${newDishName}" added to menu!`);
      setNewDishName("");
      setNewDishDesc("");
      setAdminActiveTab("orders");
      // Refresh restaurant listing
      api(`/api/restaurants?search=${encodeURIComponent(search)}`).then(setRestaurants).catch(() => {});
    } catch (err) {
      setNotice(err.message || "Failed to add dish");
    }
  }

  async function createCoupon(e) {
    e.preventDefault();
    if (!newCouponCode.trim()) return;
    try {
      const payload = {
        code: newCouponCode.trim().toUpperCase(),
        discountPercent: Number(newCouponDiscount) || 0,
        maxDiscount: Number(newCouponMaxDisc) || 500,
        minOrderValue: Number(newCouponMinOrder) || 0,
        isFreeDelivery: Boolean(newCouponFreeDel),
        description: newCouponDesc.trim() || undefined,
      };
      await api("/api/admin/coupons", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setNotice(`Coupon ${payload.code} created successfully!`);
      setNewCouponCode("");
      setNewCouponDesc("");
      const updated = await api("/api/coupons/active");
      setAdminCouponsList(updated);
    } catch (err) {
      setNotice(err.message || "Failed to create coupon");
    }
  }

  async function sendOrderToPartnerQueue(order) {
    try {
      const updated = await api(`/api/admin/orders/${order._id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "PREPARING" }),
      });
      setAdminOrders((current) =>
        current.map((item) => String(item._id) === String(updated._id) ? updated : item),
      );
    } catch (error) {
      setAdminStreamError(error.message);
    }
  }

  async function openRestaurantReviews(restaurant) {
    setViewingRestaurantReviews(restaurant);
    setReviewsLoading(true);
    try {
      const reviews = await api(`/api/restaurants/${restaurant._id}/reviews`);
      setRestaurantReviewsList(Array.isArray(reviews) ? reviews : []);
    } catch (_) {
      setRestaurantReviewsList([]);
    } finally {
      setReviewsLoading(false);
    }
  }

  async function submitOrderReview(event) {
    event.preventDefault();
    if (!reviewModalOrder) return;
    try {
      await api(`/api/orders/${reviewModalOrder.orderCode}/review`, {
        method: "POST",
        body: JSON.stringify({
          foodRating: Number(foodRating),
          deliveryRating: Number(deliveryRating),
          comment: reviewComment.trim(),
        }),
      });
      setReviewedOrders((prev) => new Set([...prev, reviewModalOrder.orderCode]));
      setNotice("Review submitted successfully! Thank you.");
      setReviewModalOrder(null);
      setReviewComment("");
      // Refresh restaurants to update the star rating and reviewCount
      api(`/api/restaurants?search=${encodeURIComponent(search)}`)
        .then(setRestaurants)
        .catch(() => {});
    } catch (error) {
      setNotice(error.message || "Failed to submit review");
    }
  }

  return (
    <div className="app">
      {isOffline && (
        <div className="offline-banner">
          <span>🔌 <b>You are offline.</b> Browsing cached restaurant menus and local history.</span>
        </div>
      )}
      {showPushPrompt && (
        <div className="push-prompt-banner">
          <span>🔔 Receive live background order and delivery status alerts?</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="push-btn-yes" onClick={requestPushSubscription}>Enable</button>
            <button type="button" className="push-btn-no" onClick={() => setShowPushPrompt(false)}>Later</button>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} style={{ cursor: "pointer" }}>
          True<span>Homes</span>
        </div>
        <input
          className="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search biryani, thali, pizza..."
        />
        <div className="actions">
          <button
            type="button"
            className={`veg-mode-toggle desktop-only ${globalVegOnly ? "active" : ""}`}
            onClick={() => setGlobalVegOnly(!globalVegOnly)}
            title="Toggle Pure Vegetarian Kitchens & Items"
          >
            <span className="veg-icon">🌱</span>
            <span>{globalVegOnly ? "Veg Only ON" : "Veg Only"}</span>
          </button>
          <button type="button" className="desktop-only" onClick={() => setTrackerOpen(true)}>
            Track Order
          </button>
          <button
            className="user-profile-btn"
            onClick={() => user ? setAccountOpen((open) => !open) : setAuthOpen(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
          >
            {user?.avatar ? (
              <img src={user.avatar} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }} />
            ) : user ? (
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#ea580c", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>
                {user.name ? user.name.charAt(0).toUpperCase() : "U"}
              </span>
            ) : null}
            <span>{user ? user.name.split(" ")[0] : "Sign in"}</span>
          </button>
          <button className="cart-button desktop-only" onClick={() => setCartOpen(true)}>
            Cart <b>{cart.reduce((sum, item) => sum + item.qty, 0)}</b>
          </button>
        </div>
        {accountOpen && user && (
          <div className="account-menu">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
            <small>{String(user.role).replace("_", " ").toUpperCase()}</small>
            <div style={{ background: "#ecfdf5", color: "#065f46", padding: "6px 10px", borderRadius: 8, fontSize: 12, fontWeight: 700, margin: "6px 0" }}>
              💰 Wallet: ₹{user.walletBalance || walletData.balance || 0}
            </div>
            <button
              type="button"
              onClick={() => {
                setAccountOpen(false);
                setProfileNameInput(user.name || "");
                setProfilePhoneInput(user.phone || "");
                setProfileAvatarInput(user.avatar || "");
                setProfileBioInput(user.bio || "");
                setProfileDietaryInput(user.dietaryPreference || "all");
                setProfileDobInput(user.dateOfBirth || "");
                setProfileGenderInput(user.gender || "prefer_not_to_say");
                setProfileActiveTab("overview");
                setProfileOpen(true);
              }}
            >
              👤 Profile & Account Details
            </button>
            {user.role === "kitchen_owner" && (
              <button type="button" onClick={() => {
                setAccountOpen(false);
                setKitchenOpen(true);
              }}>🍳 Kitchen Partner Portal</button>
            )}

        
            {user.role === "customer" && (
              <button type="button" onClick={() => {
                setAccountOpen(false);
                setCustomerOrdersOpen(true);
              }}>My orders</button>
            )}

        
            {user.role === "admin" && (
              <button type="button" onClick={openAdminOrders}>Admin orders</button>
            )}

        
            {user.role === "delivery_partner" && (
              <button type="button" onClick={() => {
                setAccountOpen(false);
                setDeliveryOpen(true);
              }}>Delivery partner dashboard</button>
            )}

        
            <button type="button" className="logout" onClick={logout}>Logout</button>
          </div>
        )}

        
      </header>

      {notice && (
        <button className="notice" onClick={() => setNotice("")}>
          {notice}
        </button>
      )}

      <main>
        <section className="hero">
          <div>
            <p>Fresh near you</p>
            <h1>Homestyle food,<br />delivered warm.</h1>
          </div>
          <div className="offer">50% OFF</div>
        </section>

        {/* Horizontal Cuisine & Quick Filter Pills Bar */}
        <div className="cuisine-filter-bar">
          {[
            ["All", "🍽️ All Cuisines"],
            ["Biryani", "🍚 Biryani"],
            ["North Indian", "🥘 North Indian"],
            ["Thalis", "🍛 Thalis"],
            ["Pizza", "🍕 Pizza"],
            ["Burgers", "🍔 Burgers"],
            ["South Indian", "🥞 South Indian"],
            ["Chinese", "🍜 Chinese"],
            ["Pure Veg", "🌱 Pure Veg"],
            ["Fast", "⚡ Under 30 Mins"],
            ["Budget", "💰 Under ₹350"],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={`cuisine-pill ${selectedCuisineFilter === key ? "active" : ""}`}
              onClick={() => setSelectedCuisineFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <section className="grid">
          {restaurants
            .filter((restaurant) => {
              if (globalVegOnly && !restaurant.isPureVeg) return false;
              if (selectedCuisineFilter === "All") return true;
              if (selectedCuisineFilter === "Pure Veg") return restaurant.isPureVeg;
              if (selectedCuisineFilter === "Fast") return Number(restaurant.deliveryTime) <= 30;
              if (selectedCuisineFilter === "Budget") return Number(restaurant.costForTwo) <= 350;
              return (restaurant.cuisines || []).some((c) =>
                c.toLowerCase().includes(selectedCuisineFilter.toLowerCase())
              );
            })
            .map((restaurant) => (
            <article className="card" key={restaurant._id}>
              {restaurant.image && (
                <img src={restaurant.image} alt="" className="card-image" />
              )}

        
              <div className="card-body">
                <div className="card-title">
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      type="button"
                      className={`fav-btn ${favorites.has(restaurant._id) ? "active" : ""}`}
                      title={favorites.has(restaurant._id) ? "Favorited" : "Add to favorites"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(restaurant._id);
                      }}
                    >
                      ♥
                    </button>
                    <h2>{restaurant.name}</h2>
                  </div>
                  <button
                    type="button"
                    className="rating-badge"
                    title="View reviews"
                    onClick={() => openRestaurantReviews(restaurant)}
                  >
                    <span>{restaurant.rating} ★</span>
                    {restaurant.reviewCount ? <small>({restaurant.reviewCount})</small> : null}
                  </button>
                </div>
                <p>{restaurant.cuisines?.join(" • ")}</p>
                <div style={{ marginTop: 4, marginBottom: 8 }}>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: '#ea580c', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}
                    onClick={() => {
                      setActiveMenuRestaurant(restaurant);
                      setMenuSearch("");
                      setMenuVegOnly(false);
                    }}
                  >
                    View Full Menu ({restaurant.menu?.length || 0} items) →
                  </button>
                </div>
                <div className="menu">
                  {restaurant.menu?.slice(0, 3).map((dish) => (
                    <button
                      className="dish"
                      key={dish._id}
                      onClick={() => addItem(restaurant, dish)}
                    >
                      <span>{dish.name}<small>₹{dish.price}</small></span>
                      <b>+</b>
                    </button>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </section>
      </main>

      {cartOpen && (
        <aside className="drawer">
          <button className="close" onClick={() => setCartOpen(false)}>×</button>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Your cart</h2>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={clearCart}
                style={{ background: "none", border: "none", color: "#ef4444", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
              >
                Clear Cart
              </button>
            )}

        
          </div>
          {cart.length === 0 ? (
            <p className="muted" style={{ padding: "40px 0", textAlign: "center" }}>Your cart is empty.</p>
          ) : (
            cart.map((item) => (
              <div className="cart-row" key={item._id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ display: "block", fontWeight: 700 }}>{item.name}</span>
                  <small style={{ color: "#64748b" }}>₹{item.price} each</small>
                </div>
                <div className="cart-row-controls">
                  <button
                    type="button"
                    className="cart-qty-btn"
                    onClick={() => updateCartItemQty(item._id, -1)}
                  >
                    -
                  </button>
                  <span className="cart-qty-count">{item.qty}</span>
                  <button
                    type="button"
                    className="cart-qty-btn"
                    onClick={() => updateCartItemQty(item._id, 1)}
                  >
                    +
                  </button>
                  <b style={{ minWidth: 50, textAlign: "right" }}>₹{item.price * item.qty}</b>
                </div>
              </div>
            ))
          )}

        

          {/* Promo code input & applied pill */}
          {appliedCoupon ? (
            <div className="applied-coupon-pill">
              <span>🎟️ <b>{appliedCoupon.code}</b> applied ({appliedCoupon.description})</span>
              <button type="button" onClick={removeCoupon}>×</button>
            </div>
          ) : (
            <div className="coupon-input-box">
              <input
                type="text"
                placeholder="PROMO CODE (e.g. TRUE50)"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
              />
              <button type="button" onClick={applyCoupon}>Apply</button>
            </div>
          )}

        
          {couponError && <p className="admin-stream-error" style={{ margin: "4px 0" }}>{couponError}</p>}

          {/* Delivery Address Selector */}
          <div className="cart-section-title">Delivery Address</div>
          <div className="address-selector-box">
            <select
              className="address-select-dropdown"
              value={selectedAddress}
              onChange={(e) => setSelectedAddress(e.target.value)}
            >
              <option value="Indirapuram, Ghaziabad">Indirapuram, Ghaziabad (Default)</option>
              {(user?.addresses || []).map((addr, idx) => (
                <option key={idx} value={addr.address}>
                  {addr.label}: {addr.address}
                </option>
              ))}
            </select>
            {user && (
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input
                  type="text"
                  placeholder="+ Add new address…"
                  value={newAddressInput}
                  onChange={(e) => setNewAddressInput(e.target.value)}
                  style={{ flex: 1, padding: "4px 8px", fontSize: 11, border: "1px solid #cbd5e1", borderRadius: 8 }}
                />
                <button
                  type="button"
                  onClick={saveNewAddress}
                  style={{ background: "#475569", color: "#fff", border: "none", borderRadius: 8, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}
                >
                  Save
                </button>
              </div>
            )}

        
          </div>

          {/* Rider Tip Selector */}
          <div className="cart-section-title">Rider Tip (100% goes to rider)</div>
          <div className="tip-selector-row">
            {[0, 20, 30, 50].map((amount) => (
              <button
                type="button"
                key={amount}
                className={`tip-pill ${riderTip === amount ? "active" : ""}`}
                onClick={() => setRiderTip(amount)}
              >
                {amount === 0 ? "None" : `₹${amount}`}
              </button>
            ))}
          </div>

          {/* Payment Method Selector */}
          <div className="cart-section-title">Payment Method</div>
          <div className="payment-selector-row">
            <button
              type="button"
              className={`payment-option-btn ${paymentMethod === "COD" ? "active" : ""}`}
              onClick={() => setPaymentMethod("COD")}
            >
              💵 Cash on Delivery
            </button>
            <button
              type="button"
              className={`payment-option-btn ${paymentMethod === "RAZORPAY" ? "active" : ""}`}
              onClick={() => setPaymentMethod("RAZORPAY")}
            >
              💳 UPI / Online (Razorpay)
            </button>
          </div>

          {/* Wallet Split-Pay Checkbox */}
          {user && (user.walletBalance || walletData.balance || 0) > 0 && (
            <div className="wallet-checkout-box" style={{ margin: "10px 0", padding: "10px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#166534" }}>
                <input
                  type="checkbox"
                  checked={useWalletBalance}
                  onChange={(e) => setUseWalletBalance(e.target.checked)}
                />
                <span>Use Wallet Balance (Available: ₹{user.walletBalance || walletData.balance})</span>
              </label>
              {useWalletBalance && (
                <div style={{ fontSize: 11, color: "#15803d", marginTop: 4 }}>
                  ₹{walletDeduction} will be deducted from your wallet.
                </div>
              )}

        
            </div>
          )}

        
          <div style={{ fontSize: 11, color: "#047857", background: "#ecfdf5", padding: "6px 10px", borderRadius: 8, margin: "8px 0" }}>
            🎉 <b>5% Cashback</b> (approx ₹{Math.max(1, Math.round(subtotal * 0.05))}) will be credited to your wallet upon delivery!
          </div>

          <div className="cart-summary" style={{ fontSize: 13, borderTop: "1px solid #e2e8f0", paddingTop: 8, marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", margin: "4px 0" }}>
              <span>Item Total</span><span>₹{subtotal}</span>
            </div>
            {discount > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", margin: "4px 0", color: "#059669", fontWeight: 700 }}>
                <span>Discount</span><span>-₹{discount}</span>
              </div>
            )}

        
            <div style={{ display: "flex", justifyContent: "space-between", margin: "4px 0" }}>
              <span>Delivery Fee</span><span>{deliveryFee === 0 ? "FREE" : `₹${deliveryFee}`}</span>
            </div>
            {riderTip > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", margin: "4px 0", color: "#ea580c" }}>
                <span>Rider Tip</span><span>₹{riderTip}</span>
              </div>
            )}

        
            {useWalletBalance && walletDeduction > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", margin: "4px 0", color: "#16a34a", fontWeight: 700 }}>
                <span>Wallet Balance Applied</span><span>-₹{walletDeduction}</span>
              </div>
            )}

        
          </div>

          <div className="total"><span>To Pay</span><b>₹{finalTotal}</b></div>
          <button className="checkout" onClick={checkout}>
            {paymentMethod === "RAZORPAY" ? `Pay ₹${finalTotal} with Razorpay` : `Place COD Order (₹${finalTotal})`}
          </button>
        </aside>
      )}

      {authOpen && (
        <div className="modal-backdrop" onMouseDown={() => setAuthOpen(false)}>
          <form className="modal" onSubmit={login} onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="close" onClick={() => setAuthOpen(false)}>×</button>
            <h2>{authMode === "login" ? "Sign in" : authRole === "delivery_partner" ? "Apply as delivery partner" : "Create account"}</h2>
            <div className="auth-role-tabs">
              {[
                ["customer", "Customer"],
                ["admin", "Admin"],
                ["delivery_partner", "Delivery partner"],
                ["kitchen_owner", "Kitchen owner"],
              ].map(([role, label]) => (
                <button
                  type="button"
                  key={role}
                  className={authRole === role ? "active" : ""}
                  onClick={() => {
                    setAuthRole(role);
                    setAuthMode("login");
                  }}
                >{label}</button>
              ))}
            </div>
            <div className="auth-tabs">
              <button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>Sign in</button>
              {authRole !== "admin" && (
                <button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>
                  {authRole === "delivery_partner" ? "Apply" : "Register"}
                </button>
              )}

        
            </div>
            {authMode === "register" && (
              <>
                <label>Name<input name="name" minLength="2" maxLength="60" required /></label>
                <label>Phone<input name="phone" minLength="10" maxLength="15" required /></label>
                {authRole === "customer" && (
                  <label>Referral Code (Optional)<input name="referralCode" placeholder="e.g. THA1B2" maxLength="12" /></label>
                )}

        
                {authRole === "delivery_partner" && (
                  <p className="muted">Partner access starts after admin approval. GPS is shared only after you start it for an active delivery.</p>
                )}

        
                {authRole === "kitchen_owner" && (
                  <p className="muted">Kitchen owner portal. Manage dish stocks, open/close status, and live incoming orders.</p>
                )}

        
              </>
            )}

        
            <label>Email<input name="email" type="email" required /></label>
            <label>Password<input name="password" type="password" minLength="8" required /></label>
            <button className="checkout" type="submit">
              {authMode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>
      )}

      {adminOpen && (
        <div className="modal-backdrop" onMouseDown={() => setAdminOpen(false)}>
          <section className="admin-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-dashboard-heading">
              <div>
                <h2>Admin Control Center</h2>
                <p className="muted">
                  Live orders, delivery partner applications, and kitchen management
                </p>
              </div>
              <div className="admin-dashboard-actions">
                <span className={`admin-stream-status ${adminStreamStatus}`}>
                  {adminStreamStatus === "live"
                    ? "Live updates"
                    : adminStreamStatus === "connecting"
                      ? "Connecting…"
                      : adminStreamStatus === "reconnecting"
                        ? "Reconnecting…"
                        : adminStreamStatus === "error"
                          ? "Connection error"
                          : "Offline"}
                </span>
                <button type="button" className="close" onClick={() => setAdminOpen(false)}>×</button>
              </div>
            </div>

            {/* Admin Tabs */}
            <div className="admin-tab-row">
              <button
                type="button"
                className={`admin-nav-tab ${adminActiveTab === "orders" ? "active" : ""}`}
                onClick={() => setAdminActiveTab("orders")}
              >
                Live Orders ({adminOrders.length})
              </button>
              <button
                type="button"
                className={`admin-nav-tab ${adminActiveTab === "applications" ? "active" : ""}`}
                onClick={() => setAdminActiveTab("applications")}
              >
                Rider Applications ({partnerApplications.length})
              </button>
              <button
                type="button"
                className={`admin-nav-tab ${adminActiveTab === "add-kitchen" ? "active" : ""}`}
                onClick={() => setAdminActiveTab("add-kitchen")}
              >
                + Add Kitchen
              </button>
              <button
                type="button"
                className={`admin-nav-tab ${adminActiveTab === "add-dish" ? "active" : ""}`}
                onClick={() => setAdminActiveTab("add-dish")}
              >
                + Add Dish to Menu
              </button>
              <button
                type="button"
                className={`admin-nav-tab ${adminActiveTab === "coupons" ? "active" : ""}`}
                onClick={() => {
                  setAdminActiveTab("coupons");
                  api("/api/coupons/active").then(setAdminCouponsList).catch(() => {});
                }}
              >
                Manage Coupons
              </button>
              <button
                type="button"
                className={`admin-nav-tab ${adminActiveTab === "analytics" ? "active" : ""}`}
                onClick={() => {
                  setAdminActiveTab("analytics");
                  api("/api/admin/analytics").then(setAdminAnalytics).catch(() => {});
                }}
              >
                📊 Analytics
              </button>
              <button
                type="button"
                className={`admin-nav-tab ${adminActiveTab === "reviews" ? "active" : ""}`}
                onClick={() => {
                  setAdminActiveTab("reviews");
                  api("/api/admin/reviews").then(setAdminReviews).catch(() => {});
                }}
              >
                ⭐ Reviews ({adminReviews.length})
              </button>
            </div>

            {adminStreamError && (
              <p className="admin-stream-error" role="alert">{adminStreamError}</p>
            )}

        

            {/* TAB: Add Kitchen Form */}
            {adminActiveTab === "add-kitchen" && (
              <form className="admin-form-card" onSubmit={createRestaurant}>
                <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800 }}>Add New Restaurant / Cloud Kitchen</h3>
                <div className="admin-form-grid">
                  <div>
                    <label>Kitchen Name *</label>
                    <input
                      required
                      placeholder="e.g. Royal Biryani Darbar"
                      value={newKitchenName}
                      onChange={(e) => setNewKitchenName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label>Cuisines (comma separated) *</label>
                    <input
                      required
                      placeholder="e.g. Biryani, Mughlai, Kebabs"
                      value={newKitchenCuisines}
                      onChange={(e) => setNewKitchenCuisines(e.target.value)}
                    />
                  </div>
                  <div>
                    <label>Delivery Time (mins)</label>
                    <input
                      type="number"
                      min="10"
                      max="90"
                      value={newKitchenTime}
                      onChange={(e) => setNewKitchenTime(e.target.value)}
                    />
                  </div>
                  <div>
                    <label>Cost for Two (₹)</label>
                    <input
                      type="number"
                      min="50"
                      max="5000"
                      value={newKitchenCost}
                      onChange={(e) => setNewKitchenCost(e.target.value)}
                    />
                  </div>
                  <div>
                    <label>Location</label>
                    <input
                      placeholder="e.g. Indirapuram, Ghaziabad"
                      value={newKitchenLocation}
                      onChange={(e) => setNewKitchenLocation(e.target.value)}
                    />
                  </div>
                  <div>
                    <label>Cover Image URL (optional)</label>
                    <input
                      placeholder="https://..."
                      value={newKitchenImage}
                      onChange={(e) => setNewKitchenImage(e.target.value)}
                    />
                  </div>
                </div>
                <button type="submit" className="partner-action" style={{ padding: "8px 20px" }}>
                  Save & Publish Kitchen
                </button>
              </form>
            )}

        

            {/* TAB: Add Dish Form */}
            {adminActiveTab === "add-dish" && (
              <form className="admin-form-card" onSubmit={createDish}>
                <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800 }}>Add Dish to Kitchen Menu</h3>
                <div className="admin-form-grid">
                  <div>
                    <label>Target Kitchen *</label>
                    <select
                      value={dishTargetRestaurantId || (restaurants[0]?._id || "")}
                      onChange={(e) => setDishTargetRestaurantId(e.target.value)}
                    >
                      {restaurants.map((r) => (
                        <option key={r._id} value={r._id}>{r.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>Dish Name *</label>
                    <input
                      required
                      placeholder="e.g. Butter Chicken Gravy"
                      value={newDishName}
                      onChange={(e) => setNewDishName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label>Price (₹) *</label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={newDishPrice}
                      onChange={(e) => setNewDishPrice(e.target.value)}
                    />
                  </div>
                  <div>
                    <label>Category</label>
                    <input
                      placeholder="e.g. Mains, Starters, Breads"
                      value={newDishCategory}
                      onChange={(e) => setNewDishCategory(e.target.value)}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 16, margin: "8px 0 12px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", textTransform: "none", fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={newDishIsVeg}
                      onChange={(e) => setNewDishIsVeg(e.target.checked)}
                    />
                    🌱 Pure Vegetarian
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", textTransform: "none", fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={newDishIsBestseller}
                      onChange={(e) => setNewDishIsBestseller(e.target.checked)}
                    />
                    ★ Bestseller Dish
                  </label>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label>Description (optional)</label>
                  <input
                    placeholder="Short description of ingredients or preparation…"
                    value={newDishDesc}
                    onChange={(e) => setNewDishDesc(e.target.value)}
                  />
                </div>
                <button type="submit" className="partner-action" style={{ padding: "8px 20px" }}>
                  Add Dish to Menu
                </button>
              </form>
            )}

        

            {/* TAB: Manage Coupons */}
            {adminActiveTab === "coupons" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <form className="admin-form-card" onSubmit={createCoupon}>
                  <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800 }}>Create Promotional Coupon</h3>
                  <div className="admin-form-grid">
                    <div>
                      <label>Coupon Code *</label>
                      <input
                        required
                        placeholder="e.g. FESTIVE40"
                        value={newCouponCode}
                        onChange={(e) => setNewCouponCode(e.target.value.toUpperCase())}
                      />
                    </div>
                    <div>
                      <label>Discount % *</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={newCouponDiscount}
                        onChange={(e) => setNewCouponDiscount(Number(e.target.value))}
                        disabled={newCouponFreeDel}
                      />
                    </div>
                    <div>
                      <label>Max Discount (₹)</label>
                      <input
                        type="number"
                        min="0"
                        value={newCouponMaxDisc}
                        onChange={(e) => setNewCouponMaxDisc(Number(e.target.value))}
                        disabled={newCouponFreeDel}
                      />
                    </div>
                    <div>
                      <label>Min Order Value (₹)</label>
                      <input
                        type="number"
                        min="0"
                        value={newCouponMinOrder}
                        onChange={(e) => setNewCouponMinOrder(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", textTransform: "none", fontSize: 13, fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={newCouponFreeDel}
                        onChange={(e) => setNewCouponFreeDel(e.target.checked)}
                        style={{ width: "auto" }}
                      />
                      Is Free Delivery Coupon
                    </label>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label>Description / Terms</label>
                    <input
                      placeholder="e.g. 40% OFF up to ₹150 on orders above ₹199"
                      value={newCouponDesc}
                      onChange={(e) => setNewCouponDesc(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="partner-action" style={{ padding: "8px 20px" }}>
                    Create Coupon
                  </button>
                </form>

                <div className="admin-form-card" style={{ padding: 12 }}>
                  <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 800 }}>Active Coupons ({adminCouponsList.length})</h3>
                  {adminCouponsList.length === 0 ? (
                    <p className="muted">No active coupons found.</p>
                  ) : (
                    <table className="admin-coupon-table">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Benefit</th>
                          <th>Min Order</th>
                          <th>Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminCouponsList.map((c, idx) => (
                          <tr key={c.code || idx}>
                            <td><span className="coupon-badge">{c.code}</span></td>
                            <td>
                              {c.isFreeDelivery
                                ? "Free Delivery"
                                : `${c.discountPercent}% OFF (max ₹${c.maxDiscount || 500})`}
                            </td>
                            <td>₹{c.minOrderValue || 0}</td>
                            <td className="muted">{c.description || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

        
                </div>
              </div>
            )}

        

            {/* TAB: Analytics & Revenue */}
            {adminActiveTab === "analytics" && (
              <div className="admin-analytics-view">
                {!adminAnalytics ? (
                  <p className="muted" style={{ padding: 20 }}>Loading business metrics…</p>
                ) : (
                  <>
                    <div className="analytics-metrics-grid">
                      <div className="metric-box">
                        <span className="metric-title">Total Orders</span>
                        <span className="metric-val">{adminAnalytics.totalOrders}</span>
                        <span className="metric-sub">{adminAnalytics.deliveredOrders} delivered</span>
                      </div>
                      <div className="metric-box highlight">
                        <span className="metric-title">Gross Revenue</span>
                        <span className="metric-val">₹{adminAnalytics.totalRevenue.toLocaleString()}</span>
                        <span className="metric-sub">Net delivered order value</span>
                      </div>
                      <div className="metric-box">
                        <span className="metric-title">Rider Tips</span>
                        <span className="metric-val">₹{adminAnalytics.totalTips.toLocaleString()}</span>
                        <span className="metric-sub">100% passed to riders</span>
                      </div>
                      <div className="metric-box">
                        <span className="metric-title">Active Kitchens</span>
                        <span className="metric-val">{adminAnalytics.activeKitchens}</span>
                        <span className="metric-sub">Onboarded partners</span>
                      </div>
                    </div>

                    <div className="admin-form-card" style={{ marginTop: 14 }}>
                      <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800 }}>Top Selling Items</h3>
                      {(!adminAnalytics.topItems || adminAnalytics.topItems.length === 0) ? (
                        <p className="muted">No sales recorded yet.</p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {adminAnalytics.topItems.map((item, idx) => (
                            <div key={item._id || idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f1f5f9", paddingBottom: 6 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
                                #{idx + 1} {item._id}
                              </span>
                              <span style={{ fontSize: 12, color: "#64748b" }}>
                                <b>{item.count}</b> orders (₹{item.volume.toLocaleString()})
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

        
                    </div>
                  </>
                )}

        
              </div>
            )}

        

            {/* TAB: Customer Reviews & Ratings */}
            {adminActiveTab === "reviews" && (
              <div className="admin-form-card" style={{ marginTop: 14 }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 800 }}>
                  Customer Reviews & Ratings ({adminReviews.length})
                </h3>
                {adminReviews.length === 0 ? (
                  <p className="muted">No customer reviews submitted yet.</p>
                ) : (
                  <div style={{ display: "grid", gap: 10, maxHeight: 420, overflowY: "auto" }}>
                    {adminReviews.map((rev) => (
                      <div key={rev._id} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <div>
                            <strong>Order #{rev.orderCode}</strong>
                            <span style={{ fontSize: 12, color: "#64748b", marginLeft: 8 }}>by {rev.reviewerName}</span>
                          </div>
                          <span style={{ fontSize: 12, color: "#94a3b8" }}>{new Date(rev.createdAt).toLocaleDateString()}</span>
                        </div>
                        <div style={{ display: "flex", gap: 16, margin: "6px 0", fontSize: 13 }}>
                          <span>🍲 Food Rating: <b>{"★".repeat(rev.foodRating || 5)}</b> ({rev.foodRating}/5)</span>
                          {rev.deliveryRating && (
                            <span>🛵 Delivery Rating: <b>{"★".repeat(rev.deliveryRating)}</b> ({rev.deliveryRating}/5)</span>
                          )}
                        </div>
                        {rev.comment && (
                          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#334155", fontStyle: "italic" }}>
                            "{rev.comment}"
                          </p>
                        )}
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 6, display: "flex", gap: 12 }}>
                          {rev.restaurantId?.name && <span>Kitchen: <b>{rev.restaurantId.name}</b></span>}
                          {rev.deliveryPartnerName && <span>Rider: <b>{rev.deliveryPartnerName}</b></span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB: Rider Applications */}
            {adminActiveTab === "applications" && (
              <section className="partner-approval-section">
                <h3>Delivery partner applications</h3>
                {partnerApplicationsError && <p className="admin-stream-error" role="alert">{partnerApplicationsError}</p>}
                {partnerApplications.length === 0 ? (
                  <p className="muted">No pending applications.</p>
                ) : (
                  <div className="partner-application-list">
                    {partnerApplications.map((partner) => (
                      <article className="partner-application" key={partner._id}>
                        <div><strong>{partner.name}</strong><span>{partner.email} · {partner.phone || "No phone"}</span></div>
                        <button type="button" onClick={() => approvePartner(partner._id)}>Approve</button>
                      </article>
                    ))}
                  </div>
                )}

        
              </section>
            )}

        

            {/* TAB: Live Orders */}
            {adminActiveTab === "orders" && (
              adminOrders.length === 0 ? (
                <p className="muted">
                  {adminStreamStatus === "live"
                    ? "No orders found."
                    : "Loading orders…"}
                </p>
              ) : (
                <div className="admin-order-list">
                  {adminOrders.map((order) => (
                    <article className="admin-order" key={order._id}>
                      <div>
                        <strong>{order.orderCode}</strong>
                        <span className={`order-status ${String(order.status).toLowerCase()}`}>
                          {order.status} · {order.paymentStatus}
                        </span>
                      </div>
                      <p><b>Customer:</b> {order.customerName || "Not provided"}</p>
                      <p><b>Phone:</b> {order.customerPhone || "Not provided"}</p>
                      <p><b>Address:</b> {order.deliveryAddress || "Not provided"}</p>
                      <p><b>Restaurant:</b> {order.restaurantName}</p>
                      <p><b>Items:</b> {(order.items || []).map((item) => `${item.name} ×${item.qty}`).join(", ") || "Not provided"}</p>
                      <p><b>Total:</b> ₹{order.grandTotal}</p>
                      <p><b>Placed:</b> {order.createdAt ? new Date(order.createdAt).toLocaleString() : "Not provided"}</p>
                      {order.assignedPartnerId && <p><b>Delivery partner:</b> {order.assignedPartnerName || "Assigned"}</p>}
                      {order.status === "CONFIRMED" && (
                        <button type="button" className="partner-action" onClick={() => sendOrderToPartnerQueue(order)}>
                          Send to partner claim queue
                        </button>
                      )}

        
                      {order.status === "PREPARING" && !order.assignedPartnerId && (
                        <p className="muted">Available in the delivery partner claim queue.</p>
                      )}

        
                      {order.assignedPartnerId && <LiveDeliveryMap order={order} />}
                    </article>
                  ))}
                </div>
              )
            )}

        
          </section>
        </div>
      )}

      {customerOrdersOpen && (
        <div className="modal-backdrop" onMouseDown={() => setCustomerOrdersOpen(false)}>
          <section className="admin-modal tracking-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-dashboard-heading">
              <div>
                <h2>My orders</h2>
                <p className="muted">Live order and delivery partner updates</p>
              </div>
              <button type="button" className="close" onClick={() => setCustomerOrdersOpen(false)}>×</button>
            </div>
            {customerOrdersError && <p className="admin-stream-error" role="alert">{customerOrdersError}</p>}
            {customerOrders.length === 0 ? <p className="muted">No orders found.</p> : (
              <div className="admin-order-list">
                {customerOrders.map((order) => (
                  <article className="admin-order" key={order._id}>
                    <div>
                      <strong>{order.orderCode}</strong>
                      <span className={`order-status ${String(order.status).toLowerCase()}`}>{order.status}</span>
                    </div>
                    <p><b>Restaurant:</b> {order.restaurantName}</p>
                    <p><b>Address:</b> {order.deliveryAddress}</p>
                    <p><b>Delivery partner:</b> {order.assignedPartnerName || "Waiting for a partner"}</p>
                    {order.deliveryOtp && order.status !== "DELIVERED" && order.status !== "CANCELLED" && (
                      <p style={{ margin: "4px 0", fontSize: 13, color: "#047857" }}>
                        <b>Delivery OTP:</b> <span className="coupon-badge" style={{ background: "#d1fae5", color: "#065f46", borderColor: "#a7f3d0" }}>{order.deliveryOtp}</span> (Share with delivery partner upon arrival)
                      </p>
                    )}

        
                    {order.status === "CANCELLED" && (
                      <p style={{ margin: "4px 0", fontSize: 13, color: "#dc2626" }}>
                        <b>Cancelled:</b> {order.cancellationReason || "Order was cancelled"} {order.paymentStatus === "REFUNDED" ? "(Refund Initiated)" : ""}
                      </p>
                    )}

        
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      {["CONFIRMED", "PREPARING"].includes(order.status) && (
                        <button
                          type="button"
                          className="partner-action secondary"
                          style={{ color: "#dc2626", borderColor: "#fca5a5" }}
                          onClick={() => cancelCustomerOrder(order)}
                        >
                          ✕ Cancel Order
                        </button>
                      )}

        
                      <button
                        type="button"
                        className="partner-action secondary"
                        onClick={() => reorderItems(order)}
                      >
                        ↻ Reorder Items
                      </button>
                      <button
                        type="button"
                        className="partner-action secondary"
                        onClick={() => setInvoiceOrder(order)}
                      >
                        📄 Receipt / Invoice
                      </button>
                      {["PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"].includes(order.status) && (
                        <button
                          type="button"
                          className="partner-action secondary chat-btn"
                          onClick={() => setChatOrderCode(order.orderCode)}
                        >
                          💬 Live Chat
                        </button>
                      )}

        
                      {order.status === "DELIVERED" && !reviewedOrders.has(order.orderCode) && (
                        <button
                          type="button"
                          className="partner-action"
                          onClick={() => {
                            setReviewModalOrder(order);
                            setFoodRating(5);
                            setDeliveryRating(5);
                            setReviewComment("");
                          }}
                        >
                          Rate & Review
                        </button>
                      )}

        
                    </div>
                    {order.status === "DELIVERED" && reviewedOrders.has(order.orderCode) && (
                      <p className="muted" style={{ marginTop: 4 }}>✓ You reviewed this order</p>
                    )}

        
                    {order.assignedPartnerId && <LiveDeliveryMap order={order} />}
                  </article>
                ))}
              </div>
            )}

        
          </section>
        </div>
      )}

      {deliveryOpen && user?.role === "delivery_partner" && (
        <div className="modal-backdrop" onMouseDown={() => setDeliveryOpen(false)}>
          <section className="admin-modal delivery-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-dashboard-heading">
              <div>
                <h2>Delivery partner</h2>
                <p className="muted">Claim an order to see its customer details.</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  type="button"
                  className={`duty-status-pill ${user?.isAvailable !== false ? "online" : "offline"}`}
                  onClick={toggleRiderAvailability}
                  title="Click to toggle active duty availability"
                >
                  <span>{user?.isAvailable !== false ? "🟢 Online" : "🔴 Offline"}</span>
                </button>
                <button type="button" className="close" onClick={() => setDeliveryOpen(false)}>×</button>
              </div>
            </div>
            {partnerOrdersError && <p className="admin-stream-error" role="alert">{partnerOrdersError}</p>}
            {locationError && <p className="admin-stream-error" role="alert">{locationError}</p>}
            {partnerOrders.length === 0 ? <p className="muted">No open or assigned orders right now.</p> : (
              <div className="admin-order-list">
                {partnerOrders.map((order) => {
                  const assignedToMe = String(order.assignedPartnerId || "") === String(user.id);
                  return (
                    <article className="admin-order" key={order._id}>
                      <div>
                        <strong>{order.orderCode}</strong>
                        <span className={`order-status ${String(order.status).toLowerCase()}`}>{order.status}</span>
                      </div>
                      <p><b>Restaurant:</b> {order.restaurantName}</p>
                      <p><b>Items:</b> {(order.items || []).map((item) => `${item.name} ×${item.qty}`).join(", ")}</p>
                      {assignedToMe ? (
                        <>
                          <p><b>Customer:</b> {order.customerName}</p>
                          <p><b>Phone:</b> {order.customerPhone}</p>
                          <p><b>Address:</b> {order.deliveryAddress}</p>
                          {order.status === "PREPARING" && (
                            <button type="button" className="partner-action" onClick={() => updateDeliveryStatus(order, "OUT_FOR_DELIVERY")}>
                              Start delivery
                            </button>
                          )}

        
                          {order.status === "OUT_FOR_DELIVERY" && (
                            <>
                              <div className="partner-actions">
                                <button
                                  type="button"
                                  className="partner-action"
                                  onClick={() => startLocationSharing(order)}
                                  disabled={sharingOrderId === String(order._id)}
                                >
                                  {sharingOrderId === String(order._id) ? "GPS sharing on" : "Start GPS sharing"}
                                </button>
                                {sharingOrderId === String(order._id) && (
                                  <button type="button" className="partner-action secondary" onClick={stopLocationSharing}>Stop sharing</button>
                                )}

        
                                <button
                                  type="button"
                                  className="partner-action secondary chat-btn"
                                  onClick={() => setChatOrderCode(order.orderCode)}
                                >
                                  💬 Chat Customer
                                </button>
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                  <input
                                    placeholder="4-digit OTP"
                                    maxLength={4}
                                    value={riderDeliveryOtp[order._id] || ""}
                                    onChange={(e) => setRiderDeliveryOtp({ ...riderDeliveryOtp, [order._id]: e.target.value })}
                                    style={{ width: 85, padding: "6px 8px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 12, textAlign: "center" }}
                                  />
                                  <button
                                    type="button"
                                    className="partner-action secondary"
                                    onClick={() => updateDeliveryStatus(order, "DELIVERED")}
                                  >
                                    Verify & Deliver
                                  </button>
                                </div>
                              </div>
                              <LiveDeliveryMap order={order} />
                            </>
                          )}

        
                          {order.status === "DELIVERED" && <p className="muted">Delivery complete.</p>}
                        </>
                      ) : (
                        <button type="button" className="partner-action" onClick={() => claimDeliveryOrder(order)}>Claim order</button>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {/* Rider's Received Customer Ratings & Reviews */}
            <div style={{ marginTop: 20, borderTop: "2px solid #e2e8f0", paddingTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
                  ⭐ Customer Delivery Reviews ({deliveryReviews.length})
                </h3>
                {deliveryReviews.length > 0 && (
                  <span style={{ fontSize: 13, color: "#15803d", fontWeight: 700 }}>
                    Avg: {(deliveryReviews.reduce((sum, r) => sum + (r.deliveryRating || 5), 0) / deliveryReviews.length).toFixed(1)} ★
                  </span>
                )}
              </div>
              {deliveryReviews.length === 0 ? (
                <p className="muted" style={{ fontSize: 12 }}>No customer delivery feedback received yet.</p>
              ) : (
                <div style={{ display: "grid", gap: 8, maxHeight: 180, overflowY: "auto" }}>
                  {deliveryReviews.map((rev) => (
                    <div key={rev._id} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10, fontSize: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <strong>Order #{rev.orderCode}</strong>
                        <span style={{ color: "#eab308", fontWeight: 800 }}>{"★".repeat(rev.deliveryRating || 5)} ({rev.deliveryRating || 5}/5)</span>
                      </div>
                      {rev.comment && <p style={{ margin: "4px 0 0", color: "#334155", fontStyle: "italic" }}>"{rev.comment}"</p>}
                      <small style={{ color: "#94a3b8" }}>By {rev.reviewerName} · {new Date(rev.createdAt).toLocaleDateString()}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>

        
          </section>
        </div>
      )}

      {/* Standalone Order Tracker Modal by Code */}
      {trackerOpen && (
        <div className="modal-backdrop" onMouseDown={() => setTrackerOpen(false)}>
          <section className="modal" style={{ maxWidth: 500 }} onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" className="close" onClick={() => setTrackerOpen(false)}>×</button>
            <h2>Live Order Tracker</h2>
            <p className="muted">Track live preparation, rider assignment, and GPS progress</p>

            <form onSubmit={lookupTrackOrder} style={{ display: "flex", gap: 8, margin: "14px 0" }}>
              <input
                type="text"
                placeholder="Enter order code (e.g. TH-ABC123)"
                value={trackerCodeInput}
                onChange={(e) => setTrackerCodeInput(e.target.value)}
                style={{ flex: 1, textTransform: "uppercase", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 10, fontSize: 13 }}
                required
              />
              <button type="submit" className="partner-action" disabled={trackerConnecting}>
                {trackerConnecting ? "Tracking…" : "Track"}
              </button>
            </form>

            {trackerError && <p className="admin-stream-error">{trackerError}</p>}

            {trackedOrder && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{trackedOrder.orderCode}</strong>
                  <span className={`order-status ${String(trackedOrder.status).toLowerCase()}`}>
                    {trackedOrder.status}
                  </span>
                </div>

                {/* Progress Stepper */}
                <div className="stepper-container">
                  {["CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"].map((st, idx) => {
                    const statuses = ["CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"];
                    const currentIdx = statuses.indexOf(trackedOrder.status);
                    const isCompleted = currentIdx >= idx;
                    const isActive = currentIdx === idx;
                    return (
                      <div key={st} className={`step-node ${isCompleted ? "completed" : ""} ${isActive ? "active" : ""}`}>
                        <div className="step-circle">{idx + 1}</div>
                        <span>{st.replace(/_/g, " ")}</span>
                      </div>
                    );
                  })}
                </div>

                <div style={{ background: "#f8fafc", padding: 12, borderRadius: 12, fontSize: 13, border: "1px solid #f1f5f9" }}>
                  <p style={{ margin: "4px 0" }}><b>Kitchen:</b> {trackedOrder.restaurantName}</p>
                  <p style={{ margin: "4px 0" }}><b>Rider:</b> {trackedOrder.assignedPartnerName || "Assigning rider…"}</p>
                  <p style={{ margin: "4px 0" }}><b>Items:</b> {(trackedOrder.items || []).map((i) => `${i.name} ×${i.qty}`).join(", ")}</p>
                  <p style={{ margin: "4px 0" }}><b>Amount:</b> ₹{trackedOrder.grandTotal} ({trackedOrder.paymentStatus})</p>
                  {trackedOrder.deliveryOtp && trackedOrder.status !== "DELIVERED" && trackedOrder.status !== "CANCELLED" && (
                    <p style={{ margin: "4px 0", color: "#047857" }}>
                      <b>Delivery Verification OTP:</b> <span className="coupon-badge" style={{ background: "#d1fae5", color: "#065f46", borderColor: "#a7f3d0" }}>{trackedOrder.deliveryOtp}</span>
                    </p>
                  )}

                  {trackedOrder.status === "DELIVERED" && (
                    <div style={{ marginTop: 10, padding: "10px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10 }}>
                      <p style={{ margin: "0 0 8px", color: "#15803d", fontWeight: 700 }}>
                        🎉 Order has been delivered! How was your experience?
                      </p>
                      {!reviewedOrders.has(trackedOrder.orderCode) ? (
                        <button
                          type="button"
                          className="partner-action"
                          style={{ padding: "8px 18px", fontSize: 13 }}
                          onClick={() => {
                            setReviewModalOrder(trackedOrder);
                            setFoodRating(5);
                            setDeliveryRating(5);
                            setReviewComment("");
                          }}
                        >
                          ⭐ Rate Food & Delivery Rider
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>
                          ✓ Thank you! You have reviewed this order.
                        </span>
                      )}
                    </div>
                  )}

                  {trackedOrder.status === "CANCELLED" && (
                    <p style={{ margin: "4px 0", color: "#dc2626" }}>
                      <b>Status:</b> Cancelled ({trackedOrder.cancellationReason || "No reason specified"})
                    </p>
                  )}
                </div>

                {trackedOrder.deliveryLocation && (
                  <div style={{ marginTop: 12 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, margin: "6px 0", color: "#ea580c" }}>
                      🛵 Rider is on the way (Live GPS)
                    </p>
                    <LiveDeliveryMap order={trackedOrder} />
                  </div>
                )}

        
              </div>
            )}

        
          </section>
        </div>
      )}

      {/* Full Categorized Restaurant Menu Modal */}
      {activeMenuRestaurant && (
        <div className="modal-backdrop" onMouseDown={() => setActiveMenuRestaurant(null)}>
          <section
            className="modal menu-modal-container"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="menu-header-bar">
              <div>
                <h2>{activeMenuRestaurant.name}</h2>
                <p className="muted">
                  {activeMenuRestaurant.cuisines?.join(" • ")} · {activeMenuRestaurant.deliveryTime} mins · ₹{activeMenuRestaurant.costForTwo} for two
                </p>
              </div>
              <button type="button" className="close" onClick={() => setActiveMenuRestaurant(null)}>×</button>
            </div>

            <div className="menu-controls-row">
              <input
                className="menu-search-input"
                placeholder="Search dish in menu…"
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
              />
              <button
                type="button"
                className={`veg-filter-pill ${menuVegOnly ? "active" : ""}`}
                onClick={() => setMenuVegOnly((v) => !v)}
              >
                🌱 Veg Only
              </button>
            </div>

            <div className="menu-categories-scroll">
              {(() => {
                const filteredDishes = (activeMenuRestaurant.menu || []).filter((d) => {
                  if (menuVegOnly && !d.isVeg) return false;
                  if (menuSearch && !d.name.toLowerCase().includes(menuSearch.toLowerCase())) return false;
                  return true;
                });

                if (filteredDishes.length === 0) {
                  return <p className="muted" style={{ padding: "30px 0", textAlign: "center" }}>No items match your filter.</p>;
                }

                // Group by category
                const groups = {};
                for (const dish of filteredDishes) {
                  const cat = dish.category || "Main Menu";
                  if (!groups[cat]) groups[cat] = [];
                  groups[cat].push(dish);
                }

                return Object.entries(groups).map(([cat, dishes]) => (
                  <div className="menu-category-section" key={cat}>
                    <h3 className="menu-category-title">{cat} ({dishes.length})</h3>
                    <div className="menu-items-list">
                      {dishes.map((dish) => (
                        <div className="menu-full-item" key={dish._id}>
                          <div className="menu-full-item-info">
                            <div className="menu-full-item-name">
                              <span className={dish.isVeg ? "badge-veg" : "badge-nonveg"}>
                                {dish.isVeg ? "🟢" : "🔴"}
                              </span>
                              <span>{dish.name}</span>
                              {dish.isBestseller && <span className="badge-bestseller">★ BESTSELLER</span>}
                            </div>
                            <div className="menu-full-item-price">₹{dish.price}</div>
                            {dish.description && <p className="menu-full-item-desc">{dish.description}</p>}
                          </div>
                          <button
                            type="button"
                            className="partner-action"
                            style={{ padding: "6px 14px", fontSize: 13, alignSelf: "center" }}
                            onClick={() => {
                              addItem(activeMenuRestaurant, dish);
                              setNotice(`Added ${dish.name} to cart`);
                              playOrderChime();
                            }}
                          >
                            + ADD
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </section>
        </div>
      )}
      {/* Kitchen Owner Portal Modal */}
      {kitchenOpen && (user?.role === "kitchen_owner" || user?.role === "admin") && (
        <div className="modal-backdrop" onMouseDown={() => setKitchenOpen(false)}>
          <section className="admin-modal" style={{ maxWidth: 640 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="admin-dashboard-heading">
              <div>
                <h2>🍳 Kitchen Partner Portal</h2>
                <p className="muted">
                  {myKitchen ? myKitchen.name : "Loading kitchen…"} · {myKitchen?.location || "Indirapuram, Ghaziabad"}
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {myKitchen && (
                  <button
                    type="button"
                    className={`duty-status-pill ${myKitchen.isOpen !== false ? "online" : "offline"}`}
                    onClick={toggleKitchenDuty}
                    title="Toggle Kitchen Open/Closed"
                  >
                    <span>{myKitchen.isOpen !== false ? "🟢 Kitchen Open" : "🔴 Closed"}</span>
                  </button>
                )}
                <button type="button" className="close" onClick={() => setKitchenOpen(false)}>×</button>
              </div>
            </div>

            {/* Portal Tab Navigation */}
            <div className="admin-tab-row" style={{ marginBottom: 14 }}>
              <button
                type="button"
                className={`admin-nav-tab ${kitchenTab === "orders" ? "active" : ""}`}
                onClick={() => setKitchenTab("orders")}
              >
                Orders ({kitchenOrders.length})
              </button>
              <button
                type="button"
                className={`admin-nav-tab ${kitchenTab === "menu" ? "active" : ""}`}
                onClick={() => setKitchenTab("menu")}
              >
                Menu Items ({(myKitchen?.menu || []).length})
              </button>
              <button
                type="button"
                className={`admin-nav-tab ${kitchenTab === "reviews" ? "active" : ""}`}
                onClick={() => {
                  setKitchenTab("reviews");
                  api("/api/kitchen/my/reviews").then(setKitchenReviews).catch(() => {});
                }}
              >
                Customer Reviews ({kitchenReviews.length})
              </button>
            </div>

            {/* TAB 1: Live Kitchen Orders */}
            {kitchenTab === "orders" && (
              <div>
                {kitchenOrders.length === 0 ? (
                  <p className="muted" style={{ padding: "20px 0", textAlign: "center" }}>No active or past orders for your kitchen yet.</p>
                ) : (
                  <div className="admin-order-list" style={{ maxHeight: 420, overflowY: "auto" }}>
                    {kitchenOrders.map((ord) => (
                      <article className="admin-order" key={ord._id}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <strong>Order #{ord.orderCode}</strong>
                          <span className={`order-status ${String(ord.status).toLowerCase()}`}>{ord.status}</span>
                        </div>
                        <p style={{ margin: "4px 0" }}>
                          <b>Items:</b> {(ord.items || []).map((i) => `${i.name} ×${i.qty}`).join(", ")}
                        </p>
                        <p style={{ margin: "4px 0" }}>
                          <b>Amount:</b> ₹{ord.grandTotal} ({ord.paymentMethod})
                        </p>
                        <p style={{ margin: "4px 0", fontSize: 12, color: "#64748b" }}>
                          <b>Delivery Partner:</b> {ord.assignedPartnerName || "Awaiting rider assignment"}
                        </p>

                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button
                            type="button"
                            className="partner-action secondary chat-btn"
                            onClick={() => setChatOrderCode(ord.orderCode)}
                          >
                            💬 Chat Order
                          </button>
                        </div>

                        {/* Live Location of Delivery Partner shown to Kitchen Owner */}
                        {ord.status === "OUT_FOR_DELIVERY" && ord.deliveryLocation && (
                          <div style={{ marginTop: 10, background: "#fff7ed", padding: 8, borderRadius: 8, border: "1px solid #fdba74" }}>
                            <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "#ea580c" }}>
                              🛵 Live Rider GPS Location (En Route to Customer):
                            </p>
                            <LiveDeliveryMap order={ord} />
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: Menu Items Availability */}
            {kitchenTab === "menu" && (
              <div>
                <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Toggle item stock on or off in real-time:</p>
                <div style={{ display: "grid", gap: 8, maxHeight: 400, overflowY: "auto" }}>
                  {(myKitchen?.menu || []).map((dish) => (
                    <div
                      key={dish._id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 10,
                        padding: "10px 14px"
                      }}
                    >
                      <div>
                        <strong>{dish.name}</strong>
                        <span style={{ fontSize: 12, color: "#64748b", marginLeft: 8 }}>₹{dish.price} ({dish.category})</span>
                        <div style={{ fontSize: 11, color: dish.isAvailable !== false ? "#16a34a" : "#dc2626", fontWeight: 700 }}>
                          {dish.isAvailable !== false ? "● In Stock" : "○ Out of Stock"}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`partner-action ${dish.isAvailable !== false ? "" : "secondary"}`}
                        onClick={() => toggleDishStock(dish._id)}
                        style={{ padding: "6px 12px", fontSize: 12 }}
                      >
                        {dish.isAvailable !== false ? "Mark Out of Stock" : "Mark In Stock"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 3: Kitchen Customer Reviews */}
            {kitchenTab === "reviews" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 15 }}>Customer Ratings & Feedback ({kitchenReviews.length})</h3>
                  {kitchenReviews.length > 0 && (
                    <span style={{ color: "#eab308", fontWeight: 800 }}>
                      Avg: {(kitchenReviews.reduce((sum, r) => sum + r.foodRating, 0) / kitchenReviews.length).toFixed(1)} ★
                    </span>
                  )}
                </div>
                {kitchenReviews.length === 0 ? (
                  <p className="muted" style={{ padding: "20px 0", textAlign: "center" }}>No customer reviews received yet for your kitchen.</p>
                ) : (
                  <div style={{ display: "grid", gap: 10, maxHeight: 400, overflowY: "auto" }}>
                    {kitchenReviews.map((rev) => (
                      <div key={rev._id} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <strong>Order #{rev.orderCode}</strong>
                          <span style={{ color: "#eab308", fontWeight: 700 }}>{"★".repeat(rev.foodRating || 5)} ({rev.foodRating}/5)</span>
                        </div>
                        {rev.comment && <p style={{ margin: "4px 0", fontSize: 13, color: "#334155", fontStyle: "italic" }}>"{rev.comment}"</p>}
                        <small style={{ color: "#94a3b8" }}>By {rev.reviewerName} · {new Date(rev.createdAt).toLocaleDateString()}</small>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Invoice / Tax Receipt Modal */}
      {invoiceOrder && (
        <div className="modal-backdrop" onMouseDown={() => setInvoiceOrder(null)}>
          <section
            className="invoice-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="no-print" style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="close" onClick={() => setInvoiceOrder(null)}>×</button>
            </div>
            <div className="invoice-header">
              <div className="invoice-brand">True<span>Homes</span></div>
              <p style={{ fontSize: 13, fontWeight: 700, margin: "2px 0", color: "#1e293b" }}>Tax Invoice / Order Receipt</p>
              <div className="invoice-meta">
                <span>Order: <b>{invoiceOrder.orderCode}</b></span> · <span>Date: {new Date(invoiceOrder.createdAt || Date.now()).toLocaleDateString()}</span>
              </div>
            </div>

            <div style={{ fontSize: 11, color: "#64748b", margin: "8px 0" }}>
              <div><b>Kitchen:</b> {invoiceOrder.restaurantName}</div>
              <div><b>Delivered to:</b> {invoiceOrder.customerName || user?.name} · {invoiceOrder.deliveryAddress}</div>
              <div><b>Payment:</b> {invoiceOrder.paymentMethod} ({invoiceOrder.paymentStatus})</div>
            </div>

            <table className="invoice-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th style={{ textAlign: "center" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Price</th>
                </tr>
              </thead>
              <tbody>
                {(invoiceOrder.items || []).map((it, idx) => (
                  <tr key={idx}>
                    <td>{it.name}</td>
                    <td style={{ textAlign: "center" }}>{it.qty}</td>
                    <td style={{ textAlign: "right" }}>₹{(it.unitPrice || 0) * (it.qty || 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 12 }}>
              <div className="invoice-breakdown-row">
                <span>Items Subtotal</span>
                <span>₹{invoiceOrder.itemTotal || invoiceOrder.grandTotal}</span>
              </div>
              {invoiceOrder.discount > 0 && (
                <div className="invoice-breakdown-row" style={{ color: "#059669" }}>
                  <span>Discount</span>
                  <span>-₹{invoiceOrder.discount}</span>
                </div>
              )}

        
              <div className="invoice-breakdown-row">
                <span>Delivery Fee</span>
                <span>₹{invoiceOrder.deliveryFee || 0}</span>
              </div>
              <div className="invoice-breakdown-row">
                <span>GST (5% Taxes)</span>
                <span>₹{invoiceOrder.tax || Math.round((invoiceOrder.itemTotal || 0) * 0.05)}</span>
              </div>
              {invoiceOrder.tip > 0 && (
                <div className="invoice-breakdown-row" style={{ color: "#ea580c" }}>
                  <span>Rider Tip</span>
                  <span>₹{invoiceOrder.tip}</span>
                </div>
              )}

        
              <div className="invoice-total-row">
                <span>Total Paid</span>
                <span>₹{invoiceOrder.grandTotal}</span>
              </div>
            </div>

            <div className="no-print" style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button
                type="button"
                className="partner-action"
                style={{ flex: 1 }}
                onClick={() => window.print()}
              >
                🖨️ Print / Save Receipt
              </button>
              <button
                type="button"
                className="partner-action secondary"
                onClick={() => setInvoiceOrder(null)}
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}

      {reviewModalOrder && (
        <div className="modal-backdrop" onMouseDown={() => setReviewModalOrder(null)}>
          <form
            className="modal review-modal"
            onSubmit={submitOrderReview}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button type="button" className="close" onClick={() => setReviewModalOrder(null)}>×</button>
            <h2>Rate your order</h2>
            <p className="muted">{reviewModalOrder.restaurantName} · Order {reviewModalOrder.orderCode}</p>

            <label>Food Rating (1–5 ★)</label>
            <div className="star-rating-row">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  type="button"
                  key={star}
                  className={`star-btn ${foodRating >= star ? "active" : ""}`}
                  onClick={() => setFoodRating(star)}
                >
                  ★
                </button>
              ))}
            </div>

            <label>Delivery Experience (1–5 ★)</label>
            <div className="star-rating-row">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  type="button"
                  key={star}
                  className={`star-btn ${deliveryRating >= star ? "active" : ""}`}
                  onClick={() => setDeliveryRating(star)}
                >
                  ★
                </button>
              ))}
            </div>

            <label>Comments (optional)</label>
            <textarea
              maxLength="300"
              placeholder="What did you love? Any feedback on food quality or delivery?"
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
            />
            <span className="review-char-count">{reviewComment.length}/300</span>

            <button className="checkout" type="submit" style={{ marginTop: 12 }}>
              Submit Review
            </button>
          </form>
        </div>
      )}

      {/* Restaurant Reviews Viewer Modal */}
      {viewingRestaurantReviews && (
        <div className="modal-backdrop" onMouseDown={() => setViewingRestaurantReviews(null)}>
          <section
            className="modal reviews-list-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button type="button" className="close" onClick={() => setViewingRestaurantReviews(null)}>×</button>
            <h2>{viewingRestaurantReviews.name} Reviews</h2>
            <p className="muted">
              {viewingRestaurantReviews.rating} ★ · {viewingRestaurantReviews.reviewCount || 0} customer reviews
            </p>

            {reviewsLoading ? (
              <p className="muted" style={{ padding: "20px 0" }}>Loading customer reviews…</p>
            ) : restaurantReviewsList.length === 0 ? (
              <p className="muted" style={{ padding: "20px 0" }}>No customer reviews yet. Be the first to order and review!</p>
            ) : (
              <div className="reviews-container">
                {restaurantReviewsList.map((rev, idx) => (
                  <div className="review-item" key={rev._id || idx}>
                    <div className="review-item-header">
                      <span>{rev.reviewerName || "Verified Customer"}</span>
                      <span className="review-stars">
                        {"★".repeat(rev.foodRating || 5)}{"☆".repeat(Math.max(0, 5 - (rev.foodRating || 5)))}
                      </span>
                    </div>
                    {rev.comment && <p className="review-text">"{rev.comment}"</p>}
                    <span className="review-date">
                      {rev.createdAt ? new Date(rev.createdAt).toLocaleDateString() : ""}
                      {rev.deliveryRating ? ` · Delivery: ${rev.deliveryRating}★` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}

        
          </section>
        </div>
      )}

      {/* Swiggy/Zomato/Zepto-style Profile & Address Manager Modal */}
      {profileOpen && user && (
        <div className="modal-backdrop" onMouseDown={() => setProfileOpen(false)}>
          <section className="profile-modal enhanced-profile-modal" onMouseDown={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="admin-dashboard-heading" style={{ borderBottom: "1px solid #e2e8f0", paddingBottom: 12, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div className="profile-avatar-wrapper">
                  {user.avatar ? (
                    <img src={user.avatar} alt={user.name} className="profile-avatar-img" />
                  ) : (
                    <div className="profile-avatar-placeholder">
                      {user.name ? user.name.charAt(0).toUpperCase() : "U"}
                    </div>
                  )}
                  <span className="profile-role-badge">
                    {user.role === "admin" ? "🛡️ Admin" : user.role === "delivery_partner" ? "🛵 Delivery" : user.role === "kitchen_owner" ? "🍳 Kitchen" : "🌟 Foodie"}
                  </span>
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 20 }}>{user.name}</h2>
                  <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
                    {user.email} {user.phone && `· ${user.phone}`}
                  </p>
                </div>
              </div>
              <button type="button" className="close" onClick={() => setProfileOpen(false)}>×</button>
            </div>

            {/* Quick Stats Banner (Wallet, Orders, Role) */}
            <div className="profile-quick-stats">
              <div className="stat-pill">
                <span className="stat-icon">💰</span>
                <div>
                  <small>Wallet Balance</small>
                  <strong>₹{user.walletBalance || walletData.balance || 0}</strong>
                </div>
              </div>
              <div className="stat-pill">
                <span className="stat-icon">📦</span>
                <div>
                  <small>Saved Addresses</small>
                  <strong>{(user.addresses || []).length} Places</strong>
                </div>
              </div>
              <div className="stat-pill">
                <span className="stat-icon">🥗</span>
                <div>
                  <small>Dietary Mode</small>
                  <strong style={{ textTransform: "capitalize" }}>{(user.dietaryPreference || "All").replace("_", " ")}</strong>
                </div>
              </div>
            </div>

            {/* Navigation Tabs (Zomato/Swiggy style) */}
            <div className="profile-nav-tabs">
              <button
                type="button"
                className={`profile-tab-btn ${profileActiveTab === "overview" ? "active" : ""}`}
                onClick={() => setProfileActiveTab("overview")}
              >
                📋 Overview
              </button>
              <button
                type="button"
                className={`profile-tab-btn ${profileActiveTab === "edit" ? "active" : ""}`}
                onClick={() => {
                  setProfileNameInput(user.name || "");
                  setProfilePhoneInput(user.phone || "");
                  setProfileAvatarInput(user.avatar || "");
                  setProfileBioInput(user.bio || "");
                  setProfileDietaryInput(user.dietaryPreference || "all");
                  setProfileDobInput(user.dateOfBirth || "");
                  setProfileGenderInput(user.gender || "prefer_not_to_say");
                  setProfileActiveTab("edit");
                }}
              >
                ✏️ Edit Profile
              </button>
              <button
                type="button"
                className={`profile-tab-btn ${profileActiveTab === "addresses" ? "active" : ""}`}
                onClick={() => setProfileActiveTab("addresses")}
              >
                📍 Addresses ({(user.addresses || []).length})
              </button>
              <button
                type="button"
                className={`profile-tab-btn ${profileActiveTab === "preferences" ? "active" : ""}`}
                onClick={() => setProfileActiveTab("preferences")}
              >
                ⚙️ Preferences
              </button>
            </div>

            {/* TAB 1: OVERVIEW / READ PROFILE */}
            {profileActiveTab === "overview" && (
              <div className="profile-tab-content">
                <div className="profile-details-grid">
                  <div className="profile-detail-item">
                    <span className="detail-label">Full Name</span>
                    <span className="detail-value">{user.name}</span>
                  </div>
                  <div className="profile-detail-item">
                    <span className="detail-label">Registered Email</span>
                    <span className="detail-value">{user.email}</span>
                  </div>
                  <div className="profile-detail-item">
                    <span className="detail-label">Phone Number</span>
                    <span className="detail-value">{user.phone || "Not set (Click Edit to add)"}</span>
                  </div>
                  <div className="profile-detail-item">
                    <span className="detail-label">Account Role</span>
                    <span className="detail-value" style={{ textTransform: "capitalize" }}>
                      {String(user.role).replace("_", " ")}
                    </span>
                  </div>
                  <div className="profile-detail-item">
                    <span className="detail-label">Dietary Preference</span>
                    <span className="detail-value" style={{ textTransform: "capitalize" }}>
                      {user.dietaryPreference === "veg_only" ? "🟢 Pure Veg" : user.dietaryPreference === "vegan" ? "🌱 Vegan" : user.dietaryPreference === "non_veg" ? "🍗 Non-Veg" : "🍽️ No Restriction (All)"}
                    </span>
                  </div>
                  <div className="profile-detail-item">
                    <span className="detail-label">Birthday</span>
                    <span className="detail-value">{user.dateOfBirth || "Add birthday for special offers"}</span>
                  </div>
                  {user.bio && (
                    <div className="profile-detail-item" style={{ gridColumn: "1 / -1" }}>
                      <span className="detail-label">Bio / Food Tagline</span>
                      <span className="detail-value">“{user.bio}”</span>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                  <button
                    type="button"
                    className="partner-action"
                    onClick={() => setProfileActiveTab("edit")}
                    style={{ flex: 1, padding: "10px 18px", fontSize: 13 }}
                  >
                    ✏️ Edit Personal Info & Photo
                  </button>
                  <button
                    type="button"
                    className="pill"
                    onClick={() => setProfileActiveTab("addresses")}
                    style={{ padding: "10px 18px", fontSize: 13, border: "1px solid #cbd5e1" }}
                  >
                    📍 Manage Addresses
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: EDIT PROFILE FORM */}
            {profileActiveTab === "edit" && (
              <form className="profile-tab-content" onSubmit={updateProfile}>
                <div className="avatar-picker-section">
                  <label style={{ fontSize: 13, fontWeight: 700, display: "block", marginBottom: 6 }}>
                    Profile Photo / Avatar
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                    {profileAvatarInput ? (
                      <img src={profileAvatarInput} alt="Preview" className="avatar-preview-circle" />
                    ) : (
                      <div className="avatar-preview-circle placeholder">
                        {profileNameInput ? profileNameInput.charAt(0).toUpperCase() : "U"}
                      </div>
                    )}
                    <input
                      type="url"
                      value={profileAvatarInput}
                      onChange={(e) => setProfileAvatarInput(e.target.value)}
                      placeholder="Paste image URL (https://...)"
                      style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13 }}
                    />
                  </div>
                  {/* Preset Avatar Suggestions */}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
                    <small style={{ color: "#64748b" }}>Presets:</small>
                    {[
                      { icon: "👨‍🍳", url: "https://images.unsplash.com/photo-1577219491135-ce391730fb2c?w=150" },
                      { icon: "🍕", url: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=150" },
                      { icon: "🧑‍💼", url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150" },
                      { icon: "🛵", url: "https://images.unsplash.com/photo-1526367790999-0150786686a2?w=150" }
                    ].map((p, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setProfileAvatarInput(p.url)}
                        style={{ background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 16 }}
                        title="Use preset"
                      >
                        {p.icon}
                      </button>
                    ))}
                    {profileAvatarInput && (
                      <button
                        type="button"
                        onClick={() => setProfileAvatarInput("")}
                        style={{ background: "none", border: "none", color: "#ef4444", fontSize: 11, cursor: "pointer" }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                <div className="admin-form-grid" style={{ marginBottom: 12 }}>
                  <div>
                    <label>Full Name *</label>
                    <input
                      value={profileNameInput}
                      onChange={(e) => setProfileNameInput(e.target.value)}
                      placeholder="Your full name"
                      required
                    />
                  </div>
                  <div>
                    <label>Phone Number</label>
                    <input
                      value={profilePhoneInput}
                      onChange={(e) => setProfilePhoneInput(e.target.value)}
                      placeholder="+91 9876543210"
                    />
                  </div>
                  <div>
                    <label>Date of Birth</label>
                    <input
                      type="date"
                      value={profileDobInput}
                      onChange={(e) => setProfileDobInput(e.target.value)}
                    />
                  </div>
                  <div>
                    <label>Gender</label>
                    <select
                      value={profileGenderInput}
                      onChange={(e) => setProfileGenderInput(e.target.value)}
                      style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #cbd5e1", fontSize: 13 }}
                    >
                      <option value="prefer_not_to_say">Prefer not to say</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label>Bio / Food Motto</label>
                  <input
                    value={profileBioInput}
                    onChange={(e) => setProfileBioInput(e.target.value)}
                    placeholder="e.g. Biryani lover & chai enthusiast"
                    maxLength={160}
                    style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #cbd5e1", fontSize: 13 }}
                  />
                  <small style={{ color: "#94a3b8", display: "block", marginTop: 4 }}>
                    {160 - profileBioInput.length} characters remaining
                  </small>
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  <button type="submit" className="partner-action" style={{ flex: 1, padding: "10px 20px" }}>
                    💾 Save Profile Changes
                  </button>
                  <button
                    type="button"
                    className="pill"
                    onClick={() => setProfileActiveTab("overview")}
                    style={{ padding: "10px 18px", border: "1px solid #cbd5e1" }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* TAB 3: SAVED ADDRESSES (Add, View, Edit, Delete) */}
            {profileActiveTab === "addresses" && (
              <div className="profile-tab-content">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 14 }}>Your Delivery Locations ({(user.addresses || []).length})</h3>
                  <small style={{ color: "#64748b" }}>Zomato/Swiggy instant select</small>
                </div>

                {(!user.addresses || user.addresses.length === 0) ? (
                  <p className="muted" style={{ fontSize: 13, textAlign: "center", padding: "16px 0" }}>
                    No saved addresses found. Add your Home, Work, or Friends' place below!
                  </p>
                ) : (
                  <div style={{ maxHeight: 220, overflowY: "auto", marginBottom: 14, paddingRight: 4 }}>
                    {user.addresses.map((a) => (
                      <div className="address-item-card" key={a._id || a.address}>
                        <div style={{ flex: 1 }}>
                          <span className="addr-label">
                            {a.label === "Home" ? "🏠 Home" : a.label === "Office" || a.label === "Work" ? "🏢 Work" : "📍 " + (a.label || "Other")}
                          </span>
                          <span style={{ fontSize: 13, color: "#1e293b", fontWeight: 500, display: "block", marginTop: 4 }}>
                            {a.address}
                          </span>
                          {selectedAddress === a.address && (
                            <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 700 }}>✓ Selected for current delivery</span>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <button
                            type="button"
                            className="addr-action-btn select-btn"
                            onClick={() => {
                              setSelectedAddress(a.address);
                              setNotice(`Selected address: ${a.label} (${a.address})`);
                            }}
                            title="Select as current address"
                          >
                            Select
                          </button>
                          {a._id && (
                            <button
                              type="button"
                              className="addr-action-btn edit-btn"
                              onClick={() => {
                                setEditingAddrId(a._id);
                                setEditAddrLabel(a.label || "Home");
                                setEditAddrText(a.address);
                              }}
                              title="Edit address"
                            >
                              ✏️
                            </button>
                          )}
                          {a._id && (
                            <button
                              type="button"
                              className="addr-delete-btn"
                              onClick={() => deleteProfileAddress(a._id)}
                              title="Delete address"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Edit Existing Address Inline Form */}
                {editingAddrId && (
                  <form onSubmit={saveEditedAddress} className="address-edit-box">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <strong style={{ fontSize: 13, color: "#ea580c" }}>Edit Saved Address</strong>
                      <button
                        type="button"
                        onClick={() => setEditingAddrId(null)}
                        style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 12 }}
                      >
                        Cancel
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <select
                        value={editAddrLabel}
                        onChange={(e) => setEditAddrLabel(e.target.value)}
                        style={{ width: 110, padding: 8, borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 12 }}
                      >
                        <option value="Home">Home</option>
                        <option value="Office">Office</option>
                        <option value="Hostel">Hostel</option>
                        <option value="Other">Other</option>
                      </select>
                      <input
                        value={editAddrText}
                        onChange={(e) => setEditAddrText(e.target.value)}
                        placeholder="House/Flat No, Area, Landmark, City..."
                        style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 12 }}
                        required
                      />
                    </div>
                    <button type="submit" className="partner-action" style={{ padding: "6px 16px", fontSize: 12 }}>
                      ✓ Save Changes
                    </button>
                  </form>
                )}

                {/* Add New Address Sub-form */}
                <form onSubmit={addProfileAddress} style={{ borderTop: "1px dashed #cbd5e1", paddingTop: 12, marginTop: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 6 }}>
                    + Add New Delivery Location
                  </span>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <select
                      value={profileAddrLabel}
                      onChange={(e) => setProfileAddrLabel(e.target.value)}
                      style={{ width: 110, padding: 8, borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 12 }}
                    >
                      <option value="Home">Home</option>
                      <option value="Office">Office</option>
                      <option value="Hostel">Hostel</option>
                      <option value="Other">Other</option>
                    </select>
                    <input
                      value={profileAddrText}
                      onChange={(e) => setProfileAddrText(e.target.value)}
                      placeholder="House/Flat no, Floor, Street, Landmark..."
                      style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 12 }}
                      required
                    />
                  </div>
                  <button type="submit" className="partner-action" style={{ padding: "6px 18px", fontSize: 12 }}>
                    + Save Address
                  </button>
                </form>
              </div>
            )}

            {/* TAB 4: PREFERENCES (Food dietary, Notifications) */}
            {profileActiveTab === "preferences" && (
              <div className="profile-tab-content">
                <div className="profile-section-card" style={{ marginBottom: 12 }}>
                  <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>Dietary & Food Habits</h3>
                  <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
                    Configure your dietary filters like in Swiggy or Zomato:
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      { id: "all", label: "🍽️ Anything Goes (All)", desc: "Show all delicious dishes" },
                      { id: "veg_only", label: "🟢 Pure Vegetarian", desc: "Show green dot items only" },
                      { id: "non_veg", label: "🍗 Non-Veg Lover", desc: "Chicken, Mutton, Fish" },
                      { id: "vegan", label: "🌱 100% Plant Vegan", desc: "No dairy or animal items" }
                    ].map((opt) => (
                      <div
                        key={opt.id}
                        onClick={async () => {
                          setProfileDietaryInput(opt.id);
                          try {
                            const updated = await api("/api/user/profile", {
                              method: "PATCH",
                              body: JSON.stringify({ dietaryPreference: opt.id })
                            });
                            setUser((prev) => ({ ...prev, ...updated }));
                            setNotice(`Dietary preference set to ${opt.label}`);
                          } catch (_) {}
                        }}
                        style={{
                          padding: 10,
                          borderRadius: 8,
                          border: (user.dietaryPreference || "all") === opt.id ? "2px solid #ea580c" : "1px solid #e2e8f0",
                          background: (user.dietaryPreference || "all") === opt.id ? "#fff7ed" : "#ffffff",
                          cursor: "pointer"
                        }}
                      >
                        <strong style={{ fontSize: 12, display: "block" }}>{opt.label}</strong>
                        <small style={{ color: "#64748b", fontSize: 11 }}>{opt.desc}</small>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="profile-section-card">
                  <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>App Notifications & Push</h3>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <strong style={{ fontSize: 13 }}>Live Order Status & Chimes</strong>
                      <p className="muted" style={{ fontSize: 11, margin: "2px 0 0" }}>
                        Receive instant sounds & web push alerts on status change
                      </p>
                    </div>
                    <button
                      type="button"
                      className="pill"
                      onClick={requestPushSubscription}
                      style={{ padding: "6px 14px", fontSize: 12, border: "1px solid #cbd5e1" }}
                    >
                      🔔 Check / Enable
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
      {/* Chat Modal */}
        {chatOrderCode && (
          <div className="modal-backdrop" onMouseDown={() => setChatOrderCode(null)}>
            <div className="modal" onMouseDown={e => e.stopPropagation()}>
              <button className="close" onClick={() => setChatOrderCode(null)}>×</button>
              <h3>Live Chat – Order {chatOrderCode}</h3>
              <div className="chat-messages" style={{maxHeight: '300px', overflowY: 'auto', marginBottom: '12px'}}>
                {chatMessages.map((msg, idx) => (
                  <div key={idx} className={`chat-bubble ${msg.sender === 'me' ? 'outgoing' : 'incoming'}`}>
                    <strong>{msg.sender}:</strong> {msg.message}
                  </div>
                ))}
              </div>
              <div style={{display: 'flex', gap: 8}}>
                <input
                  type="text"
                  placeholder="Type a message…"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => {if (e.key === 'Enter') sendChatMessage();}}
                />
                <button type="button" onClick={sendChatMessage}>Send</button>
              </div>
            </div>
          </div>
        )}

        {/* Swiggy/Zomato style Floating Cart Pill for Mobile */}
        {cart.length > 0 && !cartOpen && (
          <div className="mobile-floating-cart-pill" onClick={() => setCartOpen(true)}>
            <div className="mobile-floating-cart-info">
              <span className="cart-pill-qty">{cart.reduce((sum, item) => sum + item.qty, 0)} {cart.reduce((sum, item) => sum + item.qty, 0) === 1 ? "ITEM" : "ITEMS"}</span>
              <span className="cart-pill-divider">·</span>
              <span className="cart-pill-total">₹{finalTotal}</span>
            </div>
            <div className="mobile-floating-cart-btn">
              <span>View Cart</span>
              <span className="cart-pill-arrow">🛒 →</span>
            </div>
          </div>
        )}

        {/* Mobile Bottom Navigation Bar (Visible on <= 768px screens) */}
        <nav className="mobile-bottom-nav" aria-label="Mobile Navigation">
          <button
            type="button"
            className={`mobile-nav-item ${!trackerOpen && !cartOpen && !profileOpen && !customerOrdersOpen && !deliveryOpen && !kitchenOpen && !adminOpen ? "active" : ""}`}
            onClick={() => {
              setTrackerOpen(false);
              setCartOpen(false);
              setProfileOpen(false);
              setAccountOpen(false);
              setCustomerOrdersOpen(false);
              setDeliveryOpen(false);
              setKitchenOpen(false);
              setAdminOpen(false);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <span className="mobile-nav-icon">🏠</span>
            <span className="mobile-nav-label">Explore</span>
          </button>

          <button
            type="button"
            className={`mobile-nav-item ${globalVegOnly ? "active veg-active" : ""}`}
            onClick={() => setGlobalVegOnly(!globalVegOnly)}
          >
            <span className="mobile-nav-icon">🌱</span>
            <span className="mobile-nav-label">{globalVegOnly ? "Pure Veg" : "Veg Mode"}</span>
          </button>

          <button
            type="button"
            className={`mobile-nav-item ${trackerOpen ? "active" : ""}`}
            onClick={() => {
              setTrackerOpen(true);
              setCartOpen(false);
              setProfileOpen(false);
            }}
          >
            <span className="mobile-nav-icon">🛵</span>
            <span className="mobile-nav-label">Track</span>
          </button>

          <button
            type="button"
            className={`mobile-nav-item ${cartOpen ? "active" : ""}`}
            onClick={() => {
              setCartOpen(true);
              setTrackerOpen(false);
              setProfileOpen(false);
            }}
          >
            <span className="mobile-nav-icon-wrapper">
              <span className="mobile-nav-icon">🛒</span>
              {cart.reduce((sum, item) => sum + item.qty, 0) > 0 && (
                <span className="mobile-nav-badge">
                  {cart.reduce((sum, item) => sum + item.qty, 0)}
                </span>
              )}
            </span>
            <span className="mobile-nav-label">Cart</span>
          </button>

          <button
            type="button"
            className={`mobile-nav-item ${(profileOpen || accountOpen) ? "active" : ""}`}
            onClick={() => {
              if (!user) {
                setAuthOpen(true);
              } else {
                setProfileNameInput(user.name || "");
                setProfilePhoneInput(user.phone || "");
                setProfileAvatarInput(user.avatar || "");
                setProfileBioInput(user.bio || "");
                setProfileDietaryInput(user.dietaryPreference || "all");
                setProfileDobInput(user.dateOfBirth || "");
                setProfileGenderInput(user.gender || "prefer_not_to_say");
                setProfileActiveTab("overview");
                setProfileOpen(true);
              }
            }}
          >
            <span className="mobile-nav-icon">
              {user?.avatar ? (
                <img src={user.avatar} alt="" className="mobile-nav-avatar" />
              ) : (
                "👤"
              )}
            </span>
            <span className="mobile-nav-label">{user ? (user.name ? user.name.split(" ")[0] : "Profile") : "Sign In"}</span>
          </button>
        </nav>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}
