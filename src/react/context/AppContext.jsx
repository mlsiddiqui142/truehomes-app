import React, { createContext, useContext, useReducer, useCallback } from "react";

// ─── App State Context ────────────────────────────────────────────────────────

/**
 * @typedef {Object} AppState
 * @property {Object|null} user       - Logged-in user object or null
 * @property {Array}       cart       - Cart items array
 * @property {string[]}    toasts     - Toast notification messages
 * @property {boolean}     isOffline  - Offline status
 */

const initialState = {
  user: null,
  cart: [],
  toasts: [],
  isOffline: !navigator.onLine,
};

/** @type {React.Context<{ state: AppState, dispatch: React.Dispatch }>} */
export const AppContext = createContext(null);

/**
 * Reducer for global app state.
 * @param {AppState} state
 * @param {{ type: string, payload?: any }} action
 * @returns {AppState}
 */
function appReducer(state, action) {
  switch (action.type) {
    case "SET_USER":
      return { ...state, user: action.payload };
    case "CLEAR_USER":
      return { ...state, user: null };
    case "SET_CART":
      return { ...state, cart: action.payload };
    case "ADD_TO_CART": {
      const { dish, restaurant } = action.payload;
      const existing = state.cart.find((i) => i._id === dish._id);
      if (existing) {
        return {
          ...state,
          cart: state.cart.map((i) =>
            i._id === dish._id ? { ...i, qty: i.qty + 1 } : i
          ),
        };
      }
      return {
        ...state,
        cart: [
          ...state.cart,
          { ...dish, qty: 1, restaurantId: restaurant._id, restaurantName: restaurant.name },
        ],
      };
    }
    case "UPDATE_CART_QTY": {
      const { dishId, delta } = action.payload;
      return {
        ...state,
        cart: state.cart
          .map((i) => (i._id === dishId ? { ...i, qty: i.qty + delta } : i))
          .filter((i) => i.qty > 0),
      };
    }
    case "CLEAR_CART":
      return { ...state, cart: [] };
    case "ADD_TOAST":
      return { ...state, toasts: [...state.toasts, action.payload] };
    case "REMOVE_TOAST":
      return { ...state, toasts: state.toasts.filter((_, i) => i !== action.payload) };
    case "SET_OFFLINE":
      return { ...state, isOffline: action.payload };
    default:
      return state;
  }
}

/**
 * AppProvider wraps the whole app and provides global state via context.
 * @param {{ children: React.ReactNode }} props
 */
export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  /**
   * Convenience helper to push a toast message.
   * @param {string} message
   */
  const toast = useCallback(
    (message) => {
      dispatch({ type: "ADD_TOAST", payload: message });
      // Auto-dismiss after 4 seconds
      setTimeout(() => {
        dispatch({ type: "REMOVE_TOAST", payload: 0 });
      }, 4000);
    },
    [dispatch]
  );

  return (
    <AppContext.Provider value={{ state, dispatch, toast }}>
      {children}
    </AppContext.Provider>
  );
}

/**
 * Hook to consume the AppContext.
 * @returns {{ state: AppState, dispatch: React.Dispatch, toast: (msg: string) => void }}
 */
export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}
