import React, { memo } from "react";

/**
 * RestaurantCard – individual card rendered inside the restaurant grid.
 *
 * @param {Object}   props
 * @param {Object}   props.restaurant        - Restaurant data object
 * @param {boolean}  props.isFavorite        - Whether restaurant is favorited
 * @param {Function} props.onFavoriteToggle  - Callback to toggle favorite
 * @param {Function} props.onAddItem         - Callback to add a dish to cart
 * @param {Function} props.onOpenMenu        - Callback to open full menu modal
 * @param {boolean}  props.vegOnly           - If true, only show veg dishes
 */
const RestaurantCard = memo(function RestaurantCard({
  restaurant, isFavorite, onFavoriteToggle, onAddItem, onOpenMenu, vegOnly,
}) {
  const visibleMenu = vegOnly
    ? restaurant.menu.filter((d) => d.isVeg)
    : restaurant.menu;

  return (
    <article className="card" aria-label={`Restaurant: ${restaurant.name}`}>
      <img
        className="card-image"
        src={restaurant.image || "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800"}
        alt={`Food from ${restaurant.name}`}
        loading="lazy"
      />
      <div className="card-body">
        <div className="card-title">
          <h2>{restaurant.name}</h2>
          <span aria-label={`Rating: ${restaurant.avgRating || "No ratings yet"}`}>
            ⭐ {restaurant.avgRating ? restaurant.avgRating.toFixed(1) : "New"}
            {restaurant.reviewCount > 0 && (
              <span style={{ fontSize: 11, color: "#64748b" }}> ({restaurant.reviewCount})</span>
            )}
          </span>
        </div>

        <p>{restaurant.cuisines?.join(", ")} · {restaurant.deliveryTime} mins · ₹{restaurant.costForTwo} for two</p>

        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <button
            onClick={() => onOpenMenu(restaurant)}
            aria-label={`View full menu of ${restaurant.name}`}
          >
            View Full Menu
          </button>
          <button
            onClick={() => onFavoriteToggle(restaurant._id)}
            aria-label={isFavorite ? `Remove ${restaurant.name} from favorites` : `Add ${restaurant.name} to favorites`}
            aria-pressed={isFavorite}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}
          >
            {isFavorite ? "❤️" : "🤍"}
          </button>
        </div>

        {/* Quick-add top 3 dishes */}
        <div className="menu" role="list" aria-label="Quick-add dishes">
          {visibleMenu.slice(0, 3).map((dish) => (
            <button
              key={dish._id}
              className="dish"
              role="listitem"
              onClick={() => onAddItem(restaurant, dish)}
              aria-label={`Add ${dish.name} ₹${dish.price} to cart`}
              disabled={dish.isAvailable === false}
            >
              <span>
                {dish.isVeg ? "🟢" : "🔴"} {dish.name}
                {dish.isBestseller && <span style={{ color: "#ea580c", marginLeft: 4 }}>★ Bestseller</span>}
                <small>{dish.category} · {dish.isAvailable === false ? "Out of stock" : ""}</small>
              </span>
              <b>₹{dish.price}</b>
            </button>
          ))}
        </div>
      </div>
    </article>
  );
});

/**
 * RestaurantList – renders cuisine filter pills and restaurant grid.
 *
 * @param {Object}   props
 * @param {Array}    props.restaurants         - Full list of restaurants
 * @param {string}   props.cuisineFilter       - Currently selected cuisine filter
 * @param {boolean}  props.globalVegOnly       - Veg-only global filter toggle
 * @param {Set}      props.favorites           - Set of favourite restaurant IDs
 * @param {Function} props.onCuisineChange     - Change cuisine filter
 * @param {Function} props.onVegToggle         - Toggle global veg-only
 * @param {Function} props.onFavoriteToggle    - Toggle a restaurant favorite
 * @param {Function} props.onAddItem           - Add a dish to cart
 * @param {Function} props.onOpenMenu          - Open full menu modal
 */
export default memo(function RestaurantList({
  restaurants, cuisineFilter, globalVegOnly, favorites,
  onCuisineChange, onVegToggle, onFavoriteToggle, onAddItem, onOpenMenu,
}) {
  const allCuisines = ["All", ...new Set(restaurants.flatMap((r) => r.cuisines || []))];

  const filtered = restaurants.filter((r) => {
    const cuisineMatch = cuisineFilter === "All" || r.cuisines?.includes(cuisineFilter);
    const vegMatch = !globalVegOnly || r.menu.some((d) => d.isVeg);
    return cuisineMatch && vegMatch;
  });

  return (
    <section aria-label="Restaurant listing">
      {/* Filter pills */}
      <div
        className="cuisine-pills"
        role="toolbar"
        aria-label="Filter by cuisine"
        style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}
      >
        {allCuisines.map((c) => (
          <button
            key={c}
            onClick={() => onCuisineChange(c)}
            aria-pressed={cuisineFilter === c}
            className={`pill ${cuisineFilter === c ? "active" : ""}`}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              border: cuisineFilter === c ? "2px solid #ea580c" : "1px solid #e2e8f0",
              background: cuisineFilter === c ? "#fff7ed" : "white",
              cursor: "pointer",
              fontWeight: cuisineFilter === c ? 700 : 400,
            }}
          >
            {c}
          </button>
        ))}
        <button
          onClick={onVegToggle}
          aria-pressed={globalVegOnly}
          style={{
            padding: "6px 14px",
            borderRadius: 20,
            border: globalVegOnly ? "2px solid #15803d" : "1px solid #e2e8f0",
            background: globalVegOnly ? "#dcfce7" : "white",
            cursor: "pointer",
            color: "#15803d",
            fontWeight: globalVegOnly ? 700 : 400,
          }}
        >
          🟢 Veg Only
        </button>
      </div>

      {filtered.length === 0 && (
        <p style={{ textAlign: "center", color: "#64748b", marginTop: 32 }}>
          No kitchens found for this filter. Try a different search or cuisine.
        </p>
      )}

      <div className="grid" role="list" aria-label="Restaurants">
        {filtered.map((r) => (
          <div key={r._id} role="listitem">
            <RestaurantCard
              restaurant={r}
              isFavorite={favorites.has(r._id)}
              onFavoriteToggle={onFavoriteToggle}
              onAddItem={onAddItem}
              onOpenMenu={onOpenMenu}
              vegOnly={globalVegOnly}
            />
          </div>
        ))}
      </div>
    </section>
  );
});
