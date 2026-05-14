import { useState, useEffect, useCallback } from "react";
import { api, getToken, setToken, clearToken } from "./api";
import Header from "./components/Header";
import Dashboard from "./components/Dashboard";
import CompareView from "./components/CompareView";
import Admin from "./components/Admin";

function parseHash() {
  const hash = window.location.hash.slice(1); // remove #
  if (!hash) return { view: "dashboard" };
  // Format: #/compare/slug or #/admin
  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "compare" && parts[1]) {
    return { view: "compare", slug: parts[1] };
  }
  if (parts[0] === "admin") {
    return { view: "admin" };
  }
  return { view: "dashboard" };
}

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [tokenInput, setTokenInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [route, setRoute] = useState(parseHash);
  const [urls, setUrls] = useState([]);
  const [dates, setDates] = useState([]);
  const [runStatus, setRunStatus] = useState({ running: false });

  // Listen for hash changes (browser back/forward)
  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Verify stored token on mount
  useEffect(() => {
    if (getToken()) {
      api.verify().then(() => setAuthed(true)).catch(() => {
        clearToken();
        setAuthed(false);
      });
    }
  }, []);

  // Load data when authenticated
  useEffect(() => {
    if (!authed) return;
    api.getUrls().then(setUrls).catch(console.error);
    api.getDates().then(setDates).catch(console.error);
  }, [authed]);

  // Poll run status
  useEffect(() => {
    if (!authed) return;
    const interval = setInterval(() => {
      api.getStatus().then(setRunStatus).catch(console.error);
    }, 3000);
    return () => clearInterval(interval);
  }, [authed]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setToken(tokenInput);
    try {
      await api.verify();
      setAuthed(true);
      setAuthError("");
    } catch {
      clearToken();
      setAuthError("Invalid token");
    }
  };

  const handleTriggerRun = useCallback(async () => {
    try {
      await api.triggerRun();
      setRunStatus({ running: true, progress: { current: 0, total: 0 } });
    } catch (err) {
      alert(err.message);
    }
  }, []);

  const handleSelectUrl = useCallback((url, slug) => {
    window.location.hash = `#/compare/${slug}`;
  }, []);

  const handleBack = useCallback(() => {
    window.location.hash = "";
    // Refresh dates in case a run completed
    api.getDates().then(setDates).catch(console.error);
  }, []);

  // Find the full URL for the current slug
  const selectedUrl = urls.find((u) => u.slug === route.slug)?.url || "";

  // ── Auth Gate ──
  if (!authed) {
    return (
      <div className="auth-gate">
        <form className="auth-card" onSubmit={handleLogin}>
          <h1>📸 Screenshot Monitor</h1>
          <p>Enter your access token to continue.</p>
          {authError && <div className="auth-error">{authError}</div>}
          <input
            type="password"
            placeholder="Access token"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
            Sign in
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        runStatus={runStatus}
        onTriggerRun={handleTriggerRun}
        onLogout={() => { clearToken(); setAuthed(false); }}
      />
      <div className="container">
        {route.view === "admin" ? (
          <Admin />
        ) : route.view === "compare" && route.slug ? (
          <CompareView
            url={selectedUrl}
            slug={route.slug}
            onBack={handleBack}
          />
        ) : (
          <Dashboard
            urls={urls}
            dates={dates}
            onSelectUrl={handleSelectUrl}
          />
        )}
      </div>
    </div>
  );
}
