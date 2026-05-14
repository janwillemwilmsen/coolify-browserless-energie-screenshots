import { useState, useEffect } from "react";
import { api } from "../api";

export default function Admin() {
  const [urls, setUrls] = useState([]);
  const [newUrl, setNewUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [consentTexts, setConsentTexts] = useState([]);
  const [newConsent, setNewConsent] = useState("");
  const [newXPath, setNewXPath] = useState("");
  const [consentSaving, setConsentSaving] = useState(false);
  const [consentSaved, setConsentSaved] = useState(false);

  useEffect(() => {
    api.getUrls().then((data) => setUrls(data.map((u) => u.url))).catch(console.error);
    api.getConsentButtons().then(setConsentTexts).catch(console.error);
  }, []);

  // ── Sitemap management ───────────────────────────────────────────────
  const addUrl = () => {
    const trimmed = newUrl.trim();
    if (!trimmed) return;
    try {
      new URL(trimmed); // validate
    } catch {
      setError("Invalid URL format");
      return;
    }
    if (urls.includes(trimmed)) {
      setError("URL already exists");
      return;
    }
    setUrls([...urls, trimmed]);
    setNewUrl("");
    setError("");
    setSaved(false);
  };

  const removeUrl = (index) => {
    setUrls(urls.filter((_, i) => i !== index));
    setSaved(false);
  };

  const moveUrl = (index, direction) => {
    const newUrls = [...urls];
    const target = index + direction;
    if (target < 0 || target >= newUrls.length) return;
    [newUrls[index], newUrls[target]] = [newUrls[target], newUrls[index]];
    setUrls(newUrls);
    setSaved(false);
  };

  const saveSitemap = async () => {
    setSaving(true);
    setError("");
    try {
      await api.saveSitemap(urls);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  // ── Consent buttons management ───────────────────────────────────────
  const addConsent = () => {
    const trimmed = newConsent.trim();
    if (!trimmed || consentTexts.includes(trimmed)) return;
    setConsentTexts([...consentTexts, trimmed]);
    setNewConsent("");
    setConsentSaved(false);
  };

  const addXPath = () => {
    const trimmed = newXPath.trim();
    if (!trimmed || consentTexts.includes(trimmed)) return;
    setConsentTexts([...consentTexts, trimmed]);
    setNewXPath("");
    setConsentSaved(false);
  };

  const removeConsent = (index) => {
    setConsentTexts(consentTexts.filter((_, i) => i !== index));
    setConsentSaved(false);
  };

  const saveConsent = async () => {
    setConsentSaving(true);
    try {
      await api.saveConsentButtons(consentTexts);
      setConsentSaved(true);
    } catch (err) {
      setError(err.message);
    }
    setConsentSaving(false);
  };

  return (
    <div>
      <div className="compare-header">
        <a href="#" className="btn btn-ghost">← Back</a>
        <h2>Admin</h2>
      </div>

      {/* ── Sitemap Editor ── */}
      <div className="admin-section">
        <div className="admin-section-header">
          <h3>📋 Sitemap URLs</h3>
          <span className="admin-count">{urls.length} URLs</span>
        </div>

        <div className="admin-list">
          {urls.map((url, i) => (
            <div className="admin-list-item" key={i}>
              <span className="admin-list-index">{i + 1}</span>
              <span className="admin-list-text">{url}</span>
              <div className="admin-list-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => moveUrl(i, -1)}
                  disabled={i === 0}
                  title="Move up"
                >↑</button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => moveUrl(i, 1)}
                  disabled={i === urls.length - 1}
                  title="Move down"
                >↓</button>
                <button
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => removeUrl(i)}
                  title="Remove"
                >✕</button>
              </div>
            </div>
          ))}
        </div>

        <div className="admin-add-row">
          <input
            type="url"
            placeholder="https://example.com"
            value={newUrl}
            onChange={(e) => { setNewUrl(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && addUrl()}
          />
          <button className="btn btn-secondary" onClick={addUrl}>+ Add URL</button>
        </div>

        {error && <div className="admin-error">{error}</div>}

        <div className="admin-save-row">
          <button
            className="btn btn-primary"
            onClick={saveSitemap}
            disabled={saving}
          >
            {saving ? "Saving..." : "💾 Save Sitemap"}
          </button>
          {saved && <span className="admin-saved">✅ Saved!</span>}
        </div>
      </div>

      {/* ── Consent Buttons Editor ── */}
      <div className="admin-section">
        <div className="admin-section-header">
          <h3>🍪 Cookie Consent Button Texts</h3>
          <span className="admin-count">
            {consentTexts.filter(t => !t.startsWith('/') && !t.startsWith('(')).length} texts
          </span>
        </div>

        <div className="admin-list">
          {consentTexts.map((text, i) => {
            if (text.startsWith('/') || text.startsWith('(')) return null;
            return (
              <div className="admin-list-item" key={i}>
                <span className="admin-list-index">•</span>
                <span className="admin-list-text">{text}</span>
                <div className="admin-list-actions">
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => removeConsent(i)}
                    title="Remove"
                  >✕</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="admin-add-row">
          <input
            type="text"
            placeholder="e.g. Alles accepteren"
            value={newConsent}
            onChange={(e) => setNewConsent(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addConsent()}
          />
          <button className="btn btn-secondary" onClick={addConsent}>+ Add Text</button>
        </div>
      </div>

      {/* ── XPaths Editor ── */}
      <div className="admin-section">
        <div className="admin-section-header">
          <h3>🎯 Cookie Consent XPaths</h3>
          <span className="admin-count">
            {consentTexts.filter(t => t.startsWith('/') || t.startsWith('(')).length} paths
          </span>
        </div>

        <div className="admin-list">
          {consentTexts.map((text, i) => {
            if (!text.startsWith('/') && !text.startsWith('(')) return null;
            return (
              <div className="admin-list-item" key={i}>
                <span className="admin-list-index">#</span>
                <span className="admin-list-text" style={{ fontFamily: 'monospace', fontSize: '0.9em', color: 'var(--primary)' }}>
                  {text}
                </span>
                <div className="admin-list-actions">
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => removeConsent(i)}
                    title="Remove"
                  >✕</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="admin-add-row">
          <input
            type="text"
            placeholder="e.g. //button[@id='accept']"
            value={newXPath}
            onChange={(e) => setNewXPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addXPath()}
          />
          <button className="btn btn-secondary" onClick={addXPath}>+ Add XPath</button>
        </div>

        <div className="admin-save-row" style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid var(--border)' }}>
          <button
            className="btn btn-primary"
            onClick={saveConsent}
            disabled={consentSaving}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {consentSaving ? "Saving..." : "💾 Save All Consent Config"}
          </button>
          {consentSaved && <span className="admin-saved" style={{ marginLeft: '1rem' }}>✅ Saved!</span>}
        </div>
      </div>
    </div>
  );
}
