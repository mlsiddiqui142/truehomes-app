window.TrueHomesAPI = (() => {
  let accessToken = "";

  function setAccessToken(token) {
    accessToken = token || "";
  }

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");

    if (accessToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }

    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(path, {
      ...options,
      headers,
      credentials: "include",
    });

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : null;

    if (!response.ok) {
      const error = new Error(data?.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.requestId = response.headers.get("x-request-id");
      throw error;
    }

    return data;
  }

  return {
    setAccessToken,
    request,
    get: (path) => request(path),
    post: (path, body) => request(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  };
})();
