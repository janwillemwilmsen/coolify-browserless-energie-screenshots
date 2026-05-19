const API_BASE = "";

export function getToken() {
  return localStorage.getItem("screenshot_monitor_token") || "";
}

export function setToken(token) {
  localStorage.setItem("screenshot_monitor_token", token);
}

export function clearToken() {
  localStorage.removeItem("screenshot_monitor_token");
}

async function request(path, options = {}) {
  const token = getToken();
  const sep = path.includes("?") ? "&" : "?";
  const url = `${API_BASE}${path}${sep}token=${encodeURIComponent(token)}`;
  const res = await fetch(url, options);
  if (res.status === 401) {
    clearToken();
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

export const api = {
  verify: () => request("/api/verify"),
  getUrls: () => request("/api/urls"),
  getDates: () => request("/api/dates"),
  getScreenshots: (date) => request(`/api/screenshots/${date}`),
  getHistory: (slug) => request(`/api/history/${slug}`),
  getStatus: () => request("/api/status"),
  triggerRun: () => request("/api/run", { method: "POST" }),
  triggerRunSingle: (url) =>
    request("/api/run-single", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }),
  deleteScreenshot: (date, viewport, slug) =>
    request(`/api/screenshot/${date}/${viewport}/${slug}`, { method: "DELETE" }),
  getTargets: () => request("/api/targets"),
  addTarget: (data) =>
    request("/api/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  updateTarget: (id, data) =>
    request(`/api/targets/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteTarget: (id) => request(`/api/targets/${id}`, { method: "DELETE" }),
  getScenarios: (targetId) => request(`/api/targets/${targetId}/scenarios`),
  addScenario: (targetId, data) =>
    request(`/api/targets/${targetId}/scenarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  updateScenario: (id, data) =>
    request(`/api/scenarios/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteScenario: (id) => request(`/api/scenarios/${id}`, { method: "DELETE" }),
  testScenario: (url, steps) =>
    request("/api/test-scenario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, steps }),
    }),
  getConsentButtons: () => request("/api/consent-buttons"),
  saveConsentButtons: (texts) =>
    request("/api/consent-buttons", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    }),
};

export function screenshotUrl(date, viewport, slug) {
  const token = getToken();
  return `${API_BASE}/api/screenshot/${date}/${viewport}/${slug}.jpg?token=${encodeURIComponent(token)}`;
}
