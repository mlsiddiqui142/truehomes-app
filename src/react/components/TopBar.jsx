import React, { memo } from "react";

/**
 * TopBar – sticky navigation bar.
 *
 * @param {Object}   props
 * @param {string}   props.search            - Current search query
 * @param {Function} props.onSearchChange    - Callback for search input change
 * @param {Array}    props.cart              - Cart items
 * @param {Object}   props.user              - Logged-in user or null
 * @param {boolean}  props.accountOpen       - Whether account menu is open
 * @param {Function} props.onCartClick       - Open cart drawer
 * @param {Function} props.onAuthClick       - Open auth modal
 * @param {Function} props.onAccountToggle   - Toggle account menu
 * @param {Function} props.onTrackerClick    - Open order tracker
 * @param {Function} props.onKitchenClick    - Open kitchen portal (kitchen_owner)
 * @param {Function} props.onAdminClick      - Open admin dashboard (admin)
 * @param {Function} props.onDeliveryClick   - Open delivery dashboard (delivery_partner)
 * @param {Function} props.onOrdersClick     - Open customer orders (customer)
 * @param {Function} props.onLogout          - Log the user out
 * @param {number}   props.walletBalance     - Wallet balance to show in account menu
 */
const TopBar = memo(function TopBar({
  search, onSearchChange, cart, user, accountOpen,
  onCartClick, onAuthClick, onAccountToggle,
  onTrackerClick, onKitchenClick, onAdminClick,
  onDeliveryClick, onOrdersClick, onLogout,
  walletBalance,
}) {
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);

  return (
    <header className="topbar" role="banner">
      {/* Brand */}
      <div className="brand" aria-label="TrueHomes home">
        True<span>Homes</span>
      </div>

      {/* Search */}
      <input
        className="search"
        type="search"
        aria-label="Search kitchens and restaurants"
        placeholder="🔍 Search kitchens…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />

      {/* Actions */}
      <div className="actions" role="toolbar" aria-label="Site navigation">
        <button
          onClick={onTrackerClick}
          aria-label="Track an order by code"
          title="Track Order"
        >
          📦 Track
        </button>

        {user ? (
          <div style={{ position: "relative" }}>
            <button
              onClick={onAccountToggle}
              aria-haspopup="true"
              aria-expanded={accountOpen}
              aria-label={`Account menu for ${user.name}`}
            >
              👤 {user.name.split(" ")[0]}
            </button>

            {accountOpen && (
              <div
                className="account-menu"
                role="menu"
                aria-label="Account options"
              >
                <strong role="menuitem" tabIndex={-1}>{user.name}</strong>
                <span>{user.email}</span>
                <small>{String(user.role).replace("_", " ").toUpperCase()}</small>

                {typeof walletBalance === "number" && (
                  <span style={{ color: "#15803d", fontWeight: 700, fontSize: 13 }}>
                    💰 Wallet: ₹{walletBalance}
                  </span>
                )}

                {user.role === "customer" && (
                  <button role="menuitem" onClick={onOrdersClick} aria-label="View my orders">
                    My orders
                  </button>
                )}
                {user.role === "kitchen_owner" && (
                  <button role="menuitem" onClick={onKitchenClick} aria-label="Open Kitchen Partner Portal (Ctrl+K)">
                    🍳 Kitchen Portal <kbd style={{ fontSize: 10 }}>Ctrl+K</kbd>
                  </button>
                )}
                {user.role === "admin" && (
                  <button role="menuitem" onClick={onAdminClick} aria-label="Open Admin dashboard">
                    Admin dashboard
                  </button>
                )}
                {user.role === "delivery_partner" && (
                  <button role="menuitem" onClick={onDeliveryClick} aria-label="Open Delivery partner dashboard">
                    Delivery dashboard
                  </button>
                )}

                <button
                  role="menuitem"
                  className="logout"
                  onClick={onLogout}
                  aria-label="Sign out"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        ) : (
          <button onClick={onAuthClick} aria-label="Sign in or register">
            Sign In
          </button>
        )}

        <button
          className="cart-button"
          onClick={onCartClick}
          aria-label={`Open cart — ${cartCount} item${cartCount !== 1 ? "s" : ""}`}
        >
          🛒 Cart <b>{cartCount}</b>
        </button>
      </div>
    </header>
  );
});

export default TopBar;
