import React, { useCallback, useEffect } from "react";
import { useAppContext } from "../context/AppContext.jsx";

/**
 * Toast notification component — renders floating messages at bottom-centre.
 * Toasts are stored in AppContext.state.toasts and auto-dismissed after 4 s.
 */
export default function Toast() {
  const { state, dispatch } = useAppContext();

  const dismiss = useCallback(
    (index) => dispatch({ type: "REMOVE_TOAST", payload: index }),
    [dispatch]
  );

  if (!state.toasts.length) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite" aria-atomic="false">
      {state.toasts.map((msg, i) => (
        <button
          key={i}
          className="notice"
          onClick={() => dismiss(i)}
          aria-label={`Dismiss notification: ${msg}`}
        >
          {msg}
        </button>
      ))}
    </div>
  );
}
