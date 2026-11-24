window.TrueHomesCart = (() => {
  function calculateBill(state) {
    let itemTotal = 0;
    for (const item of state.cart.items) {
      itemTotal += item.price * item.qty;
    }

    let discount = 0;
    if (state.couponCode === "TRUE50" && itemTotal >= 199) {
      discount = Math.min(Math.round(itemTotal * 0.5), 100);
    }

    let deliveryFee = itemTotal >= 299 ? 0 : 35;
    if (state.couponCode === "FREEDEL") deliveryFee = 0;

    const tax = Math.round((itemTotal - discount) * 0.05);
    const grandTotal = itemTotal - discount + deliveryFee + tax + state.tip;
    return { itemTotal, discount, deliveryFee, tax, grandTotal };
  }

  function clearCart(state) {
    state.cart = { restaurantId: null, restaurantName: "", items: [] };
    state.couponCode = "";
    state.tip = 0;
  }

  return { calculateBill, clearCart };
})();
