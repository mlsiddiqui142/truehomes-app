import React, { memo, useEffect } from "react";

/**
 * KitchenPortal – modal dashboard for kitchen_owner users.
 *
 * @param {Object}   props
 * @param {Object}   props.kitchen         - Kitchen data returned from /api/kitchen/my
 * @param {Array}    props.orders          - Kitchen's current orders
 * @param {string}   props.activeTab       - "orders" | "menu"
 * @param {Function} props.onTabChange     - Switch tabs
 * @param {Function} props.onToggleDuty   - Toggle kitchen open/closed
 * @param {Function} props.onToggleDish   - Toggle a dish in/out of stock
 * @param {Function} props.onOpenChat     - Open chat for a specific order code
 * @param {Function} props.onClose        - Close portal
 */
const KitchenPortal = memo(function KitchenPortal({
  kitchen, orders, activeTab, onTabChange,
  onToggleDuty, onToggleDish, onOpenChat, onClose,
}) {
  // Escape key closes modal
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Kitchen Partner Portal"
    >
      <div
        className="modal"
        style={{ width: "min(640px, 94vw)", maxHeight: "88vh" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="close" onClick={onClose} aria-label="Close kitchen portal">×</button>
        <h2 style={{ margin: 0 }}>🍳 Kitchen Dashboard</h2>

        {kitchen ? (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <strong>{kitchen.name}</strong>
                <span
                  style={{
                    marginLeft: 10,
                    padding: "3px 10px",
                    borderRadius: 20,
                    background: kitchen.isOpen ? "#dcfce7" : "#fee2e2",
                    color: kitchen.isOpen ? "#15803d" : "#b91c1c",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                  aria-label={`Kitchen status: ${kitchen.isOpen ? "Open" : "Closed"}`}
                >
                  {kitchen.isOpen ? "🟢 Open" : "🔴 Closed"}
                </span>
              </div>
              <button
                onClick={onToggleDuty}
                aria-label={kitchen.isOpen ? "Close kitchen" : "Open kitchen"}
                style={{
                  background: kitchen.isOpen ? "#fee2e2" : "#dcfce7",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 14px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {kitchen.isOpen ? "Close Kitchen" : "Open Kitchen"}
              </button>
            </div>

            {/* Tabs */}
            <div role="tablist" style={{ display: "flex", gap: 8, borderBottom: "1px solid #e2e8f0", paddingBottom: 8 }}>
              {["orders", "menu"].map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={activeTab === tab}
                  onClick={() => onTabChange(tab)}
                  style={{
                    border: "none",
                    background: "none",
                    fontWeight: activeTab === tab ? 800 : 500,
                    color: activeTab === tab ? "#ea580c" : "#64748b",
                    borderBottom: activeTab === tab ? "2px solid #ea580c" : "2px solid transparent",
                    padding: "8px 16px",
                    cursor: "pointer",
                  }}
                >
                  {tab === "orders" ? "📦 Orders" : "🍽 Menu"}
                </button>
              ))}
            </div>

            {/* Orders Tab */}
            {activeTab === "orders" && (
              <div role="tabpanel" aria-label="Kitchen orders">
                {orders.length === 0 ? (
                  <p className="muted" style={{ color: "#94a3b8", textAlign: "center" }}>No active orders right now.</p>
                ) : (
                  orders.map((order) => (
                    <div
                      key={order._id}
                      className="order-card"
                      style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, marginBottom: 10 }}
                      aria-label={`Order ${order.orderCode} — status ${order.status}`}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <strong>#{order.orderCode}</strong>
                        <span style={{ fontSize: 12, color: "#64748b" }}>{order.status}</span>
                      </div>
                      <p style={{ fontSize: 12, margin: "4px 0" }}>
                        {order.items?.map((i) => `${i.name} ×${i.qty}`).join(", ")}
                      </p>
                      <button
                        onClick={() => onOpenChat(order.orderCode)}
                        aria-label={`Open chat for order ${order.orderCode}`}
                        style={{
                          background: "#eef2ff",
                          color: "#3730a3",
                          border: "none",
                          borderRadius: 8,
                          padding: "6px 12px",
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        💬 Chat
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Menu Tab */}
            {activeTab === "menu" && (
              <div role="tabpanel" aria-label="Kitchen menu management">
                {kitchen.menu?.length === 0 && (
                  <p style={{ color: "#94a3b8", textAlign: "center" }}>No dishes yet.</p>
                )}
                {kitchen.menu?.map((dish) => (
                  <div
                    key={dish._id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 0",
                      borderBottom: "1px solid #f1f5f9",
                    }}
                    aria-label={`${dish.name} — ${dish.isAvailable !== false ? "In Stock" : "Out of Stock"}`}
                  >
                    <div>
                      <span>{dish.isVeg ? "🟢" : "🔴"} {dish.name}</span>
                      <small style={{ display: "block", color: "#64748b" }}>₹{dish.price}</small>
                    </div>
                    <button
                      onClick={() => onToggleDish(dish._id)}
                      aria-label={`Mark ${dish.name} as ${dish.isAvailable !== false ? "out of stock" : "in stock"}`}
                      style={{
                        background: dish.isAvailable !== false ? "#dcfce7" : "#fee2e2",
                        color: dish.isAvailable !== false ? "#15803d" : "#b91c1c",
                        border: "none",
                        borderRadius: 8,
                        padding: "6px 12px",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {dish.isAvailable !== false ? "In Stock" : "Out of Stock"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p style={{ color: "#94a3b8", textAlign: "center" }}>Loading kitchen data…</p>
        )}
      </div>
    </div>
  );
});

export default KitchenPortal;
