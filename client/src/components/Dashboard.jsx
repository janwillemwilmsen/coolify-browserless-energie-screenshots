import { useEffect, useState } from "react";
import { screenshotUrl } from "../api";

export default function Dashboard({ urls, dates, onSelectUrl }) {
  const latestDate = dates?.[0];

  if (!urls.length) {
    return (
      <div className="empty-state">
        <div className="icon">📋</div>
        <h3>No URLs configured</h3>
        <p>Add URLs to sitemap.xml to start monitoring.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="dashboard-header">
        <h2>Monitored Sites</h2>
        <p>
          {urls.length} URLs tracked
          {latestDate && <> · Latest capture: <strong>{latestDate}</strong></>}
        </p>
      </div>

      <div className="url-grid">
        {urls.map(({ url, slug, brand, type }) => (
          <UrlCard
            key={slug}
            url={url}
            slug={slug}
            brand={brand}
            type={type}
            latestDate={latestDate}
            onClick={() => onSelectUrl(url, slug)}
          />
        ))}
      </div>
    </div>
  );
}

function UrlCard({ url, slug, brand, type, latestDate, onClick }) {
  const [imgError, setImgError] = useState(false);
  const domain = new URL(url).hostname;

  const thumbSrc = latestDate && !imgError
    ? screenshotUrl(latestDate, "desktop", slug)
    : null;

  return (
    <div className="url-card" onClick={onClick}>
      <div className="url-card-thumb">
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt={domain}
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="no-screenshot">No screenshot yet</div>
        )}
      </div>
      <div className="url-card-info">
        <h3>{brand || domain}</h3>
        {type && (
          <div className="badge" style={{ display: "inline-block", background: "var(--primary)", color: "#fff", padding: "2px 8px", borderRadius: "12px", fontSize: "0.75rem", marginBottom: "4px" }}>
            {type}
          </div>
        )}
        <div className="meta">
          <span>{url}</span>
        </div>
      </div>
    </div>
  );
}
