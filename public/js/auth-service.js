window.TrueHomesAuth = (() => {
  function setSession(state, data) {
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("truehomes_token", data.token);
  }

  function clearSession(state) {
    state.token = "";
    state.user = null;
    localStorage.removeItem("truehomes_token");
  }

  async function restore(state) {
    if (state.token) {
      try {
        const user = await window.TrueHomesAPI.get("/api/auth/me");
        state.user = user;
        return true;
      } catch (_) {
        return refresh(state);
      }
    }
    return refresh(state);
  }

  async function refresh(state) {
    try {
      const data = await window.TrueHomesAPI.post("/api/auth/refresh");
      setSession(state, data);
      return true;
    } catch (_) {
      clearSession(state);
      return false;
    }
  }

  async function login(state, endpoint, payload) {
    const data = await window.TrueHomesAPI.post(endpoint, payload);
    setSession(state, data);
    return data;
  }

  async function logout(state) {
    try {
      await window.TrueHomesAPI.post("/api/auth/logout");
    } catch (_) {}
    clearSession(state);
  }

  return { restore, refresh, login, logout };
})();
