import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

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
  const [user, setUser] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminOrders, setAdminOrders] = useState([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api(`/api/restaurants?search=${encodeURIComponent(search)}`)
      .then(setRestaurants)
      .catch(() => setNotice("Unable to load kitchens"));
  }, [search]);

  useEffect(() => {
    const token = localStorage.getItem("truehomes_token");
    if (token) api("/api/auth/me").then(setUser).catch(() => {});
  }, []);

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
          }
        : {
            email: form.get("email"),
            password: form.get("password"),
          };
      const data = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      localStorage.setItem("truehomes_token", data.token);
      setUser(data.user);
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

    async function logout() {
      try {
        await api("/api/auth/logout", { method: "POST" });
      } catch (_) {}
      localStorage.removeItem("truehomes_token");
      setUser(null);
      setAccountOpen(false);
      setAdminOpen(false);
      setNotice("Signed out");
    }

    async function openAdminOrders() {
      setAccountOpen(false);
      setAdminOpen(true);
      try {
        setAdminOrders(await api("/api/admin/orders"));
      } catch (error) {
        setNotice(error.message);
      }
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
            {user.role === "admin" && (
              <button type="button" onClick={openAdminOrders}>Admin orders</button>
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
                  <span>{restaurant.rating} ★</span>
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
            <h2>{authMode === "login" ? "Sign in" : "Create account"}</h2>
            <div className="auth-tabs">
              <button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>Sign in</button>
              <button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>Register</button>
            </div>
            {authMode === "register" && (
              <>
                <label>Name<input name="name" minLength="2" maxLength="60" required /></label>
                <label>Phone<input name="phone" minLength="10" maxLength="15" required /></label>
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
            <button type="button" className="close" onClick={() => setAdminOpen(false)}>×</button>
            <h2>Placed orders</h2>
            {adminOrders.length === 0 ? (
              <p className="muted">No orders found.</p>
            ) : (
              <div className="admin-order-list">
                {adminOrders.map((order) => (
                  <article className="admin-order" key={order._id}>
                    <div>
                      <strong>{order.orderCode}</strong>
                      <span>{order.status} • {order.paymentStatus}</span>
                    </div>
                    <p><b>Customer:</b> {order.customerName || "Not provided"}</p>
                    <p><b>Phone:</b> {order.customerPhone || "Not provided"}</p>
                    <p><b>Address:</b> {order.deliveryAddress || "Not provided"}</p>
                    <p><b>Restaurant:</b> {order.restaurantName}</p>
                    <p><b>Total:</b> ₹{order.grandTotal}</p>
                  </article>
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
