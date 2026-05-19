import { useState, useEffect } from "react";
import { api } from "../api";

export default function Admin() {
  const [targets, setTargets] = useState([]);
  const [newUrl, setNewUrl] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const [newType, setNewType] = useState("");
  const [error, setError] = useState("");

  const [activeTarget, setActiveTarget] = useState(null); // For Scenario Builder
  const [scenarios, setScenarios] = useState([]);
  const [scenarioSaving, setScenarioSaving] = useState(false);
  const [scenarioText, setScenarioText] = useState({}); // store raw text per scenario index
  const [testImage, setTestImage] = useState(null);
  const [isTesting, setIsTesting] = useState(false);

  const [consentTexts, setConsentTexts] = useState([]);
  const [newConsent, setNewConsent] = useState("");
  const [newXPath, setNewXPath] = useState("");
  const [consentSaving, setConsentSaving] = useState(false);
  const [consentSaved, setConsentSaved] = useState(false);

  useEffect(() => {
    fetchTargets();
    api.getConsentButtons().then(setConsentTexts).catch(console.error);
  }, []);

  const fetchTargets = () => {
    api.getTargets().then(setTargets).catch(console.error);
  };

  // ── Targets Management ───────────────────────────────────────────────
  const addTarget = async () => {
    const trimmedUrl = newUrl.trim();
    if (!trimmedUrl) return;
    try {
      new URL(trimmedUrl); // validate
      await api.addTarget({ url: trimmedUrl, brand: newBrand.trim(), type: newType.trim() });
      setNewUrl("");
      setNewBrand("");
      setNewType("");
      setError("");
      fetchTargets();
    } catch (err) {
      setError(err.message || "Invalid URL format");
    }
  };

  const removeTarget = async (id) => {
    if (confirm("Are you sure you want to delete this target?")) {
      await api.deleteTarget(id);
      fetchTargets();
    }
  };

  const updateTargetInline = async (id, field, value) => {
    await api.updateTarget(id, { [field]: value });
    fetchTargets();
  };

  // ── Scenarios Management ─────────────────────────────────────────────
  const openScenarios = async (target) => {
    setActiveTarget(target);
    setTestImage(null);
    const data = await api.getScenarios(target.id);
    setScenarios(data);
    
    const initialText = {};
    data.forEach((s, i) => {
      initialText[i] = JSON.stringify(s.steps || [], null, 2);
    });
    setScenarioText(initialText);
  };

  const addScenario = async () => {
    const newScen = await api.addScenario(activeTarget.id, { name: "New Scenario", steps: [] });
    const newScenarios = [...scenarios, newScen];
    setScenarios(newScenarios);
    setScenarioText({ ...scenarioText, [newScenarios.length - 1]: "[\n\n]" });
  };

  const deleteScenario = async (id) => {
    await api.deleteScenario(id);
    const data = await api.getScenarios(activeTarget.id);
    setScenarios(data);
    const initialText = {};
    data.forEach((s, i) => {
      initialText[i] = JSON.stringify(s.steps || [], null, 2);
    });
    setScenarioText(initialText);
  };

  const updateScenarioName = (index, name) => {
    const newScens = [...scenarios];
    newScens[index].name = name;
    setScenarios(newScens);
  };

  const handleTextChange = (index, val) => {
    setScenarioText({ ...scenarioText, [index]: val });
  };

  const saveScenarios = async () => {
    setScenarioSaving(true);
    for (let i = 0; i < scenarios.length; i++) {
      const s = scenarios[i];
      let stepsArray = [];
      try {
        stepsArray = JSON.parse(scenarioText[i] || "[]");
      } catch (e) {
        alert(`Invalid JSON in scenario: ${s.name}`);
        setScenarioSaving(false);
        return;
      }
      await api.updateScenario(s.id, { name: s.name, steps: stepsArray });
    }
    setScenarioSaving(false);
    alert("Scenarios saved!");
  };

  const runTestScenario = async (index) => {
    let stepsArray = [];
    try {
      stepsArray = JSON.parse(scenarioText[index] || "[]");
    } catch (e) {
      alert("Invalid JSON in scenario");
      return;
    }
    
    setIsTesting(true);
    setTestImage(null);
    try {
      const res = await api.testScenario(activeTarget.url, stepsArray);
      setTestImage(`data:image/jpeg;base64,${res.imageBase64}`);
    } catch (err) {
      alert("Test failed: " + err.message);
    }
    setIsTesting(false);
  };

  // ── Consent buttons management ───────────────────────────────────────
  const addConsent = () => {
    const trimmed = newConsent.trim();
    if (!trimmed || consentTexts.includes(trimmed)) return;
    setConsentTexts([...consentTexts, trimmed]);
    setNewConsent("");
    setConsentSaved(false);
  };

  const addXPathConfig = () => {
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
      console.error(err);
    }
    setConsentSaving(false);
  };

  return (
    <div>
      <div className="compare-header">
        <a href="#" className="btn btn-ghost" onClick={(e) => { e.preventDefault(); activeTarget ? setActiveTarget(null) : window.location.href = '#'; }}>
          ← Back {activeTarget ? "to Targets" : ""}
        </a>
        <h2>{activeTarget ? `Scenarios: ${activeTarget.url}` : "Admin"}</h2>
      </div>

      {!activeTarget ? (
        <>
          {/* ── Targets Editor ── */}
          <div className="admin-section">
            <div className="admin-section-header">
              <h3>📋 Target URLs</h3>
              <span className="admin-count">{targets.length} Targets</span>
            </div>

            <div className="admin-list" style={{ gap: '0.5rem' }}>
              {targets.map((t, i) => (
                <div className="admin-list-item" key={t.id} style={{ display: 'grid', gridTemplateColumns: '40px 2fr 1fr 1fr auto', alignItems: 'center', gap: '1rem', padding: '0.5rem' }}>
                  <span className="admin-list-index" style={{ margin: 0 }}>{i + 1}</span>
                  <input 
                    className="admin-list-text" 
                    defaultValue={t.url} 
                    onBlur={(e) => updateTargetInline(t.id, 'url', e.target.value)}
                    style={{ background: 'transparent', border: 'none', color: 'inherit', width: '100%', outline: 'none' }}
                  />
                  <input 
                    type="text" 
                    placeholder="Brand" 
                    defaultValue={t.brand} 
                    onBlur={(e) => updateTargetInline(t.id, 'brand', e.target.value)}
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '4px 8px', borderRadius: '4px', color: 'inherit' }}
                  />
                  <input 
                    type="text" 
                    placeholder="Type" 
                    defaultValue={t.type} 
                    onBlur={(e) => updateTargetInline(t.id, 'type', e.target.value)}
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '4px 8px', borderRadius: '4px', color: 'inherit' }}
                  />
                  <div className="admin-list-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => openScenarios(t)}>Scenarios</button>
                    <button className="btn btn-ghost btn-sm btn-danger" onClick={() => removeTarget(t.id)} title="Remove">✕</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="admin-add-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '1rem' }}>
              <input type="url" placeholder="https://example.com" value={newUrl} onChange={(e) => { setNewUrl(e.target.value); setError(""); }} />
              <input type="text" placeholder="Brand" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} />
              <input type="text" placeholder="Type" value={newType} onChange={(e) => setNewType(e.target.value)} />
              <button className="btn btn-secondary" onClick={addTarget}>+ Add Target</button>
            </div>
            {error && <div className="admin-error">{error}</div>}
          </div>

          {/* ── Consent Buttons Editor (from before) ── */}
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
                      <button className="btn btn-ghost btn-sm btn-danger" onClick={() => removeConsent(i)}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="admin-add-row">
              <input type="text" placeholder="e.g. Alles accepteren" value={newConsent} onChange={(e) => setNewConsent(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addConsent()} />
              <button className="btn btn-secondary" onClick={addConsent}>+ Add Text</button>
            </div>
          </div>

          {/* ── XPaths Editor (from before) ── */}
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
                    <span className="admin-list-text" style={{ fontFamily: 'monospace', fontSize: '0.9em', color: 'var(--primary)' }}>{text}</span>
                    <div className="admin-list-actions">
                      <button className="btn btn-ghost btn-sm btn-danger" onClick={() => removeConsent(i)}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="admin-add-row">
              <input type="text" placeholder="e.g. //button[@id='accept']" value={newXPath} onChange={(e) => setNewXPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addXPathConfig()} />
              <button className="btn btn-secondary" onClick={addXPathConfig}>+ Add XPath</button>
            </div>
            <div className="admin-save-row" style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-primary" onClick={saveConsent} disabled={consentSaving} style={{ width: '100%', justifyContent: 'center' }}>
                {consentSaving ? "Saving..." : "💾 Save All Consent Config"}
              </button>
              {consentSaved && <span className="admin-saved" style={{ marginLeft: '1rem' }}>✅ Saved!</span>}
            </div>
          </div>
        </>
      ) : (
        /* ── Scenario Builder ── */
        <div className="admin-section">
          
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <a href="#/converter" target="_blank" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              🛠️ Open HTML to JSON Converter
            </a>
          </div>

          <div style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: '8px', marginBottom: '2rem', border: '1px solid var(--border)', fontSize: '0.9rem' }}>
            <h4 style={{ marginTop: 0 }}>📖 Scenario JSON Examples</h4>
            <p style={{ color: 'var(--text-muted)' }}>Paste these examples into your scenario and modify them. Valid <code>locatorType</code> values map directly to Playwright's APIs: <code>css</code> (locator), <code>role</code> (getByRole), <code>text</code> (getByText), <code>label</code> (getByLabel), <code>placeholder</code> (getByPlaceholder), <code>alt</code> (getByAltText), <code>title</code> (getByTitle), <code>testid</code> (getByTestId).</p>
            <pre style={{ background: 'var(--bg-body)', padding: '10px', borderRadius: '4px', overflowX: 'auto', border: '1px solid var(--border)' }}>
{`[
  { "type": "click", "locatorType": "role", "selector": ["button", { "name": "Sign in" }] },
  { "type": "type", "locatorType": "label", "selector": "User Name", "value": "John" },
  { "type": "type", "locatorType": "placeholder", "selector": "Password", "value": "secret" },
  { "type": "wait", "ms": 2000 },
  { "type": "waitForSelector", "locatorType": "text", "selector": "Welcome back" },
  { "type": "screenshot" }
]`}
            </pre>
          </div>

          {scenarios.map((scenario, sIdx) => (
            <div key={scenario.id} style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <input 
                  type="text" 
                  value={scenario.name} 
                  onChange={(e) => updateScenarioName(sIdx, e.target.value)}
                  style={{ fontSize: '1.2rem', fontWeight: 'bold', background: 'transparent', border: 'none', color: 'var(--text-main)', outline: 'none', borderBottom: '1px solid var(--border)' }}
                />
                <button className="btn btn-ghost btn-danger" onClick={() => deleteScenario(scenario.id)}>Delete Scenario</button>
              </div>

              <textarea 
                value={scenarioText[sIdx] !== undefined ? scenarioText[sIdx] : ""}
                onChange={(e) => handleTextChange(sIdx, e.target.value)}
                style={{ width: '100%', minHeight: '200px', fontFamily: 'monospace', padding: '10px', borderRadius: '4px', background: 'var(--bg-body)', color: 'var(--text-main)', border: '1px solid var(--border)', resize: 'vertical' }}
                placeholder="[\n  { ... }\n]"
              />

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button className="btn btn-secondary" onClick={() => runTestScenario(sIdx)} disabled={isTesting}>
                  {isTesting ? "⏳ Running Test..." : "▶️ Test Scenario"}
                </button>
                <button className="btn btn-primary" onClick={saveScenarios} disabled={scenarioSaving}>
                  {scenarioSaving ? "Saving..." : "💾 Save Scenario"}
                </button>
              </div>

              {testImage && (
                <div style={{ marginTop: '1rem', border: '1px solid var(--border)', borderRadius: '4px', padding: '1rem', background: 'var(--bg-body)' }}>
                  <h4>Test Result:</h4>
                  <img src={testImage} alt="Test Result" style={{ maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto' }} />
                </div>
              )}

            </div>
          ))}

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <button className="btn btn-secondary" onClick={addScenario}>+ Add New Scenario</button>
          </div>
        </div>
      )}
    </div>
  );
}
