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
  if ("Notification" in window) {
    if (Notification.permission === "granted") {
      new Notification(title, { body, icon: "/favicon.ico" });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
          new Notification(title, { body, icon: "/favicon.ico" });
        }
      });
    }
  }
}

function LiveDeliveryMap({ order }) {
  const location = order?.deliveryLocation;
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return <p className="muted">Delivery partner GPS has not been shared yet.</p>;
  }

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
  const [favorites, setFavorites] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("truehomes_favs") || "[]"));
    } catch (_) {
      return new Set();
    }
  });

  // New States: Cuisine & Dietary Filter Pills
  const [selectedCuisineFilter, setSelectedCuisineFilter] = useState("All");

  // New States: Admin Dashboard Tabs & Forms
  const [adminActiveTab, setAdminActiveTab] = useState("orders"); // "orders", "applications", "add-kitchen", "add-dish"
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
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!adminOpen || user?.role !== "admin") return;
    api("/api/admin/delivery-partners/pending")
      .then(setPartnerApplications)
      .catch((error) => setPartnerApplicationsError(error.message));
  }, [adminOpen, user?.role]);

  useEffect(() => {
    if (!deliveryOpen || user?.role !== "delivery_partner") {
      setPartnerOrdersError("");
      return;
    }

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

  const finalTotal = useMemo(() => {
    return Math.max(0, subtotal - discount + deliveryFee + riderTip);
  }, [subtotal, discount, deliveryFee, riderTip]);

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
          customerName: user?.name || "React Customer",
          customerPhone: user?.phone || "9876543210",
          deliveryAddress: selectedAddress,
        }),
      });

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

  async function updateDeliveryStatus(order, status) {
    try {
      const updated = await api(`/api/delivery/orders/${order._id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
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
      <header className="topbar">
        <div className="brand">True<span>Homes</span></div>
        <input
          className="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search biryani, thali, pizza..."
        />
        <div className="actions">
          <button type="button" onClick={() => setTrackerOpen(true)}>
            Track Order
          </button>
          <button onClick={() => user ? setAccountOpen((open) => !open) : setAuthOpen(true)}>
            {user?.name || "Sign in"}
          </button>
          <button className="cart-button" onClick={() => setCartOpen(true)}>
            Cart <b>{cart.reduce((sum, item) => sum + item.qty, 0)}</b>
          </button>
        </div>
        {accountOpen && user && (
          <div className="account-menu">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
            <small>{String(user.role).replace("_", " ").toUpperCase()}</small>
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
          <h2>Your cart</h2>
          {cart.map((item) => (
            <div className="cart-row" key={item._id}>
              <span>{item.name}<small>Qty {item.qty}</small></span>
              <b>₹{item.price * item.qty}</b>
            </div>
          ))}

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
                {authRole === "delivery_partner" && (
                  <p className="muted">Partner access starts after admin approval. GPS is shared only after you start it for an active delivery.</p>
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
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        type="button"
                        className="partner-action secondary"
                        onClick={() => reorderItems(order)}
                      >
                        ↻ Reorder Items
                      </button>
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
              <button type="button" className="close" onClick={() => setDeliveryOpen(false)}>×</button>
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
                                <button type="button" className="partner-action secondary" onClick={() => updateDeliveryStatus(order, "DELIVERED")}>Mark delivered</button>
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
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);
