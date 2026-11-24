window.TrueHomesRestaurants = (() => {
  async function fetchRestaurants(state, params = {}) {
    const query = new URLSearchParams(params);
    const data = await window.TrueHomesAPI.get(`/api/restaurants?${query.toString()}`);
    state.restaurants = data;
    return data;
  }

  async function fetchRestaurant(id) {
    return window.TrueHomesAPI.get(`/api/restaurants/${encodeURIComponent(id)}`);
  }

  async function fetchReviews(restaurantId) {
    return window.TrueHomesAPI.get(`/api/restaurants/${encodeURIComponent(restaurantId)}/reviews`);
  }

  return { fetchRestaurants, fetchRestaurant, fetchReviews };
})();
