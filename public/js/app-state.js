window.TrueHomesState = (() => {
  const listeners = new Set();

  function create(initialState) {
    const state = { ...initialState };
    let token = state.token || "";

    Object.defineProperty(state, "token", {
      enumerable: true,
      get: () => token,
      set: (value) => {
        token = value || "";
        if (window.TrueHomesAPI) {
          window.TrueHomesAPI.setAccessToken(token);
        }
        notify("token", token);
      },
    });

    state.token = token;

    function notify(key, value) {
      for (const listener of listeners) {
        listener(state, key, value);
      }
    }

    state.update = (updates) => {
      for (const [key, value] of Object.entries(updates)) {
        state[key] = value;
        notify(key, value);
      }
      return state;
    };

    state.subscribe = (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };

    return state;
  }

  return { create };
})();
