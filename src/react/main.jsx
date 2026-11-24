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
  const [user, setUser] = useState(null);
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
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      localStorage.setItem("truehomes_token", data.token);
      setUser(data.user);
      setAuthOpen(false);
      setNotice(`Welcome, ${data.user.name}`);
    } catch (error) {
      setNotice(error.message);
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
          <button onClick={() => setAuthOpen(true)}>{user?.name || "Sign in"}</button>
          <button className="cart-button" onClick={() => setCartOpen(true)}>
            Cart <b>{cart.reduce((sum, item) => sum + item.qty, 0)}</b>
          </button>
        </div>
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
            <h2>Sign in</h2>
            <label>Email<input name="email" type="email" required /></label>
            <label>Password<input name="password" type="password" required /></label>
            <button className="checkout" type="submit">Sign in</button>
          </form>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);
