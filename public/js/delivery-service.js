window.TrueHomesDelivery = (() => {
  function list() {
    return window.TrueHomesAPI.get("/api/delivery/orders");
  }

  function claim(orderId) {
    return window.TrueHomesAPI.request(
      `/api/delivery/orders/${encodeURIComponent(orderId)}/claim`,
      { method: "PATCH" }
    );
  }

  function updateStatus(orderId, status) {
    return window.TrueHomesAPI.request(
      `/api/delivery/orders/${encodeURIComponent(orderId)}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) }
    );
  }

  return { list, claim, updateStatus };
})();
