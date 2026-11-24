window.TrueHomesOrders = (() => {
  function place(state, payload) {
    return window.TrueHomesAPI.post("/api/orders", payload);
  }

  function lookup(state, orderCode) {
    return window.TrueHomesAPI.get(`/api/orders/${encodeURIComponent(orderCode)}`);
  }

  function history() {
    return window.TrueHomesAPI.get("/api/orders/my");
  }

  function initiatePayment(orderId) {
    return window.TrueHomesAPI.post("/api/payments/razorpay/order", { orderId });
  }

  function verifyPayment(body) {
    return window.TrueHomesAPI.post("/api/payments/razorpay/verify", body);
  }

  function submitReview(orderCode, payload) {
    return window.TrueHomesAPI.post(
      `/api/orders/${encodeURIComponent(orderCode)}/review`,
      payload
    );
  }

  return { place, lookup, history, initiatePayment, verifyPayment, submitReview };
})();
