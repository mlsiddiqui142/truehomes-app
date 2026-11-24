window.TrueHomesAdmin = (() => {
  function listOrders() {
    return window.TrueHomesAPI.get("/api/admin/orders");
  }

  function updateOrderStatus(orderId, status) {
    return window.TrueHomesAPI.request(
      `/api/admin/orders/${encodeURIComponent(orderId)}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) }
    );
  }

  function createRestaurant(body) {
    return window.TrueHomesAPI.post("/api/admin/restaurants", body);
  }

  function addDish(restaurantId, body) {
    return window.TrueHomesAPI.post(
      `/api/admin/restaurants/${encodeURIComponent(restaurantId)}/menu`,
      body
    );
  }

  function deleteRestaurant(restaurantId) {
    return window.TrueHomesAPI.request(
      `/api/admin/restaurants/${encodeURIComponent(restaurantId)}`,
      { method: "DELETE" }
    );
  }

  return { listOrders, updateOrderStatus, createRestaurant, addDish, deleteRestaurant };
})();
