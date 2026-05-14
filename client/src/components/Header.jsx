export default function Header({ runStatus, onTriggerRun, onLogout }) {
  const isRunning = runStatus?.running;
  const progress = runStatus?.progress;

  return (
    <header className="header">
      <div className="header-brand">
        <span className="icon">📸</span>
        <h1>Screenshot Monitor</h1>
      </div>

      <div className="header-actions">
        {isRunning && progress && (
          <div>
            <div className="status-badge running">
              <span className="status-dot" />
              Running {progress.current}/{progress.total}
            </div>
            {progress.total > 0 && (
              <div className="progress-bar-container">
                <div className="progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
                <div className="progress-text">
                  {progress.viewport} → {progress.url?.substring(0, 40)}
                </div>
              </div>
            )}
          </div>
        )}

        {!isRunning && (
          <div className="status-badge">
            <span className="status-dot" />
            Idle
          </div>
        )}

        <button
          className="btn btn-primary"
          onClick={onTriggerRun}
          disabled={isRunning}
        >
          {isRunning ? "⏳ Running..." : "▶ Run Now"}
        </button>

        <a href="#/admin" className="btn btn-ghost" title="Admin">
          ⚙️
        </a>

        <button className="btn btn-ghost" onClick={onLogout} title="Logout">
          🚪
        </button>
      </div>
    </header>
  );
}
