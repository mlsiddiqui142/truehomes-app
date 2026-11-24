import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

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
          paymentMethod: "COD",
          customerName: user?.name || "React Demo Customer",
          customerPhone: "9876543210",
          deliveryAddress: "Indirapuram, Ghaziabad",
        }),
      });
      setCart([]);
      setCartOpen(false);
      setNotice(`Order ${order.orderCode} placed`);
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

        <section className="grid">
          {restaurants.map((restaurant) => (
            <article className="card" key={restaurant._id}>
              {restaurant.image && (
                <img src={restaurant.image} alt="" className="card-image" />
              )}
              <div className="card-body">
                <div className="card-title">
                  <h2>{restaurant.name}</h2>
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
          <div className="total"><span>Total</span><b>₹{subtotal}</b></div>
          <button className="checkout" onClick={checkout}>Place COD order</button>
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
                <h2>Live order dashboard</h2>
                <p className="muted">
                  All orders from all customers with live status updates
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
            {adminStreamError && (
              <p className="admin-stream-error" role="alert">{adminStreamError}</p>
            )}
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
            {adminOrders.length === 0 ? (
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
                    {order.status === "DELIVERED" && !reviewedOrders.has(order.orderCode) && (
                      <button
                        type="button"
                        className="partner-action"
                        style={{ marginTop: 8 }}
                        onClick={() => {
                          setReviewModalOrder(order);
                          setFoodRating(5);
                          setDeliveryRating(5);
                          setReviewComment("");
                        }}
                      >
                        Rate & Review Order
                      </button>
                    )}
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

      {/* Review Submission Modal */}
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
