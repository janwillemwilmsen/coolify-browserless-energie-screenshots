import { useState, useEffect, useCallback } from "react";
import { api, screenshotUrl } from "../api";
import ImageSlider from "./ImageSlider";

export default function CompareView({ url, slug, onBack }) {
  const [dates, setDates] = useState([]);
  const [viewport, setViewport] = useState("desktop");
  const [mode, setMode] = useState("slider"); // "slider" | "side-by-side"
  const [zoom, setZoom] = useState(100);
  const [dateA, setDateA] = useState("");
  const [dateB, setDateB] = useState("");
  const [loading, setLoading] = useState(true);
  const [screenshotting, setScreenshotting] = useState(false);

  const domain = url ? new URL(url).hostname : slug;

  const loadHistory = useCallback(() => {
    setLoading(true);
    api.getHistory(slug)
      .then((d) => {
        setDates(d);
        if (d.length >= 2) {
          setDateA(d[1]);
          setDateB(d[0]);
        } else if (d.length === 1) {
          setDateA(d[0]);
          setDateB(d[0]);
        }
        setLoading(false);
      })
      .catch(console.error);
  }, [slug]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleScreenshot = async () => {
    if (!url) return;
    setScreenshotting(true);
    try {
      await api.triggerRunSingle(url);
      // Poll until done
      const poll = setInterval(async () => {
        const status = await api.getStatus();
        if (!status.running) {
          clearInterval(poll);
          setScreenshotting(false);
          loadHistory(); // Refresh dates
        }
      }, 2000);
    } catch (err) {
      alert(err.message);
      setScreenshotting(false);
    }
  };

  const handleDelete = async (date, vp) => {
    if (!confirm(`Delete ${vp} screenshot from ${date}?`)) return;
    try {
      await api.deleteScreenshot(date, vp, slug);
      loadHistory(); // Refresh
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteBoth = async (date) => {
    if (!confirm(`Delete ALL screenshots from ${date}?`)) return;
    try {
      await api.deleteScreenshot(date, "desktop", slug).catch(() => {});
      await api.deleteScreenshot(date, "mobile", slug).catch(() => {});
      loadHistory();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner" /></div>;
  }

  if (!dates.length) {
    return (
      <div>
        <div className="compare-header">
          <button className="btn btn-ghost" onClick={onBack}>← Back</button>
          <h2>{domain}</h2>
          <button
            className="btn btn-primary"
            onClick={handleScreenshot}
            disabled={screenshotting}
          >
            {screenshotting ? "⏳ Capturing..." : "📸 Screenshot Now"}
          </button>
        </div>
        <div className="empty-state">
          <div className="icon">📷</div>
          <h3>No screenshots yet</h3>
          <p>Click "Screenshot Now" to capture {domain}.</p>
        </div>
      </div>
    );
  }

  const imgA = dateA ? screenshotUrl(dateA, viewport, slug) : null;
  const imgB = dateB ? screenshotUrl(dateB, viewport, slug) : null;

  return (
    <div>
      <div className="compare-header">
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <h2>{domain}</h2>

        <div className="compare-controls">
          {/* Screenshot this site */}
          <button
            className="btn btn-primary"
            onClick={handleScreenshot}
            disabled={screenshotting}
          >
            {screenshotting ? "⏳ Capturing..." : "📸 Screenshot"}
          </button>

          {/* Viewport toggle */}
          <div className="toggle-group">
            <button
              className={viewport === "desktop" ? "active" : ""}
              onClick={() => setViewport("desktop")}
            >
              🖥 Desktop
            </button>
            <button
              className={viewport === "mobile" ? "active" : ""}
              onClick={() => setViewport("mobile")}
            >
              📱 Mobile
            </button>
          </div>

          {/* Mode toggle */}
          <div className="toggle-group">
            <button
              className={mode === "slider" ? "active" : ""}
              onClick={() => setMode("slider")}
            >
              Slider
            </button>
            <button
              className={mode === "side-by-side" ? "active" : ""}
              onClick={() => setMode("side-by-side")}
            >
              Side by Side
            </button>
            <button
              className={mode === "timeline" ? "active" : ""}
              onClick={() => setMode("timeline")}
            >
              Timeline
            </button>
          </div>

          {/* Date selectors (hidden in timeline mode) */}
          {mode !== "timeline" && (
            <>
              <select value={dateA} onChange={(e) => setDateA(e.target.value)}>
                {dates.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <span style={{ color: "var(--text-muted)" }}>vs</span>
              <select value={dateB} onChange={(e) => setDateB(e.target.value)}>
                {dates.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </>
          )}

          {/* Zoom */}
          <div className="toggle-group">
            {[20, 40, 60, 80, 100].map((z) => (
              <button
                key={z}
                className={zoom === z ? "active" : ""}
                onClick={() => setZoom(z)}
              >
                {z}%
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="zoom-container" style={{ width: mode === "timeline" ? "100%" : `${zoom}%` }}>
        {mode === "slider" && imgA && imgB ? (
          <ImageSlider
            beforeSrc={imgA}
            afterSrc={imgB}
            beforeLabel={dateA}
            afterLabel={dateB}
          />
        ) : mode === "timeline" ? (
          <div className="timeline-scroll">
            {dates.map((date) => (
              <div className="timeline-card" key={date} style={{ width: `${70 + zoom * 7.3}px` }}>
                <div className="compare-panel-header">
                  <span>{date}</span>
                  <span style={{ textTransform: "capitalize" }}>{viewport}</span>
                </div>
                <img
                  src={screenshotUrl(date, viewport, slug)}
                  alt={`${domain} - ${date}`}
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="compare-body side-by-side">
            <div className="compare-panel">
              <div className="compare-panel-header">
                <span>{dateA}</span>
                <span style={{ textTransform: "capitalize" }}>{viewport}</span>
              </div>
              {imgA && <img src={imgA} alt={`${domain} - ${dateA}`} />}
            </div>
            <div className="compare-panel">
              <div className="compare-panel-header">
                <span>{dateB}</span>
                <span style={{ textTransform: "capitalize" }}>{viewport}</span>
              </div>
              {imgB && <img src={imgB} alt={`${domain} - ${dateB}`} />}
            </div>
          </div>
        )}
      </div>

      {/* Screenshot history with delete */}
      <div className="history-section">
        <h3>📅 Screenshot History</h3>
        <div className="history-list">
          {dates.map((date) => (
            <div className="history-item" key={date}>
              <span className="history-date">{date}</span>
              <div className="history-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleDelete(date, "desktop")}
                  title="Delete desktop screenshot"
                >🖥 ✕</button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleDelete(date, "mobile")}
                  title="Delete mobile screenshot"
                >📱 ✕</button>
                <button
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => handleDeleteBoth(date)}
                  title="Delete both screenshots"
                >🗑 Delete All</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
