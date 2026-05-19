import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import cron from "node-cron";
import { runScreenshots, runSingleScreenshot, getRunStatus, urlToSlug, runTestScenario } from "./screenshot-worker.js";
import { 
  migrateIfNeeded, getTargets, getTarget, addTarget, updateTarget, deleteTarget,
  getScenarios, addScenario, updateScenario, deleteScenario 
} from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = process.env.PORT || 3000;
const APP_TOKEN = process.env.APP_TOKEN || "";
const BROWSERLESS_URL = process.env.BROWSERLESS_URL;
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || "";
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 6 * * 1";
const SCREENSHOTS_DIR = path.join(__dirname, "screenshots");

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());

function auth(req, res, next) {
  if (!APP_TOKEN) return next();
  const token = req.query.token || req.headers["x-auth-token"];
  if (token !== APP_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ── Serve React build ──────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "client", "dist")));

// ── API Routes ─────────────────────────────────────────────────────────────

// Verify token
app.get("/api/verify", auth, (_req, res) => {
  res.json({ ok: true });
});

// List all URLs (legacy compatibility for client, but pulls from DB now)
app.get("/api/urls", auth, async (_req, res) => {
  try {
    const targets = getTargets();
    // Return the old format for now until frontend updates
    res.json(targets.map(t => ({ url: t.url, slug: t.slug })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Targets CRUD ───────────────────────────────────────────────────────────
app.get("/api/targets", auth, (_req, res) => {
  try { res.json(getTargets()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/targets", auth, (req, res) => {
  try {
    const { url, brand, type } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });
    res.json(addTarget(url, brand, type));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/targets/:id", auth, (req, res) => {
  try {
    res.json(updateTarget(req.params.id, req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/targets/:id", auth, (req, res) => {
  try {
    deleteTarget(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Scenarios CRUD ─────────────────────────────────────────────────────────
app.get("/api/targets/:id/scenarios", auth, (req, res) => {
  try { res.json(getScenarios(req.params.id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/targets/:id/scenarios", auth, (req, res) => {
  try {
    const { name, steps } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    res.json(addScenario(req.params.id, name, steps || []));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/scenarios/:id", auth, (req, res) => {
  try {
    const { name, steps } = req.body;
    res.json(updateScenario(req.params.id, name, steps));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/scenarios/:id", auth, (req, res) => {
  try {
    deleteScenario(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/test-scenario", auth, async (req, res) => {
  try {
    const { url, steps } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });
    
    // We cannot wait synchronously without risking standard HTTP timeouts if it's super long, 
    // but tests should usually be < 60s. So we just wait.
    const result = await runTestScenario(url, steps || [], BROWSERLESS_URL, BROWSERLESS_TOKEN);
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }
    
    res.json({ imageBase64: result.imageBase64 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all screenshot dates
app.get("/api/dates", auth, (_req, res) => {
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) return res.json([]);
    const dates = fs
      .readdirSync(SCREENSHOTS_DIR)
      .filter((d) => fs.statSync(path.join(SCREENSHOTS_DIR, d)).isDirectory())
      .sort()
      .reverse();
    res.json(dates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List screenshots for a specific date
app.get("/api/screenshots/:date", auth, (req, res) => {
  try {
    const dateDir = path.join(SCREENSHOTS_DIR, req.params.date);
    if (!fs.existsSync(dateDir)) return res.json({ desktop: [], mobile: [] });

    const result = {};
    ["desktop", "mobile"].forEach((viewport) => {
      const vpDir = path.join(dateDir, viewport);
      if (fs.existsSync(vpDir)) {
        result[viewport] = fs
          .readdirSync(vpDir)
          .filter((f) => {
            if (!f.endsWith(".jpg")) return false;
            const stats = fs.statSync(path.join(vpDir, f));
            return stats.size > 0; // Skip 0-byte files
          })
          .map((f) => f.replace(".jpg", ""));
      } else {
        result[viewport] = [];
      }
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get history for a specific URL slug
app.get("/api/history/:slug", auth, (req, res) => {
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) return res.json([]);
    const slug = req.params.slug;
    const dates = fs.readdirSync(SCREENSHOTS_DIR).filter((d) => {
      const dir = path.join(SCREENSHOTS_DIR, d);
      if (!fs.statSync(dir).isDirectory()) return false;
      
      const checkFile = (vp, s) => {
        const filepath = path.join(dir, vp, `${s}.jpg`);
        return fs.existsSync(filepath) && fs.statSync(filepath).size > 0;
      };

      return checkFile("desktop", slug) || checkFile("mobile", slug);
    });
    res.json(dates.sort().reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve screenshot image
app.get("/api/screenshot/:date/:viewport/:filename", auth, (req, res) => {
  const { date, viewport, filename } = req.params;
  const slug = filename.replace(".jpg", "");
  const filepath = path.join(SCREENSHOTS_DIR, date, viewport, `${slug}.jpg`);

  if (!fs.existsSync(filepath) || fs.statSync(filepath).size === 0) {
    return res.status(404).json({ error: "Screenshot not found" });
  }

  res.sendFile(filepath);
});

// Trigger a full screenshot run (all URLs)
app.post("/api/run", auth, (_req, res) => {
  const status = getRunStatus();
  if (status?.running) {
    return res.status(409).json({ error: "A run is already in progress", status });
  }

  runScreenshots(BROWSERLESS_URL, BROWSERLESS_TOKEN).catch((err) => {
    console.error("Screenshot run failed:", err);
  });

  res.json({ status: "started" });
});

// Trigger a single-site screenshot run
app.post("/api/run-single", auth, (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }
  const status = getRunStatus();
  if (status?.running) {
    return res.status(409).json({ error: "A run is already in progress", status });
  }

  runSingleScreenshot(url, BROWSERLESS_URL, BROWSERLESS_TOKEN).catch((err) => {
    console.error("Single screenshot run failed:", err);
  });

  res.json({ status: "started", url });
});

// Delete a specific screenshot
app.delete("/api/screenshot/:date/:viewport/:slug", auth, (req, res) => {
  const { date, viewport, slug } = req.params;
  const filepath = path.join(SCREENSHOTS_DIR, date, viewport, `${slug}.jpg`);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: "Screenshot not found" });
  }

  fs.unlinkSync(filepath);

  // Clean up empty directories
  const vpDir = path.join(SCREENSHOTS_DIR, date, viewport);
  if (fs.existsSync(vpDir) && fs.readdirSync(vpDir).length === 0) {
    fs.rmdirSync(vpDir);
  }
  const dateDir = path.join(SCREENSHOTS_DIR, date);
  if (fs.existsSync(dateDir) && fs.readdirSync(dateDir).length === 0) {
    fs.rmdirSync(dateDir);
  }

  res.json({ ok: true, deleted: `${date}/${viewport}/${slug}.jpg` });
});

// Get current run status
app.get("/api/status", auth, (_req, res) => {
  res.json(getRunStatus() || { running: false });
});

// Get consent button texts
app.get("/api/consent-buttons", auth, (_req, res) => {
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(__dirname, "consent-buttons.json"), "utf-8")
    );
    res.json(data);
  } catch {
    res.json([]);
  }
});


// Save consent button texts
app.put("/api/consent-buttons", auth, (req, res) => {
  try {
    const { texts } = req.body;
    if (!Array.isArray(texts)) {
      return res.status(400).json({ error: "texts must be an array" });
    }
    fs.writeFileSync(
      path.join(__dirname, "consent-buttons.json"),
      JSON.stringify(texts, null, 2) + "\n"
    );
    res.json({ ok: true, count: texts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback — serve React app for all non-API routes
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "client", "dist", "index.html"));
});

// ── Cron schedule ──────────────────────────────────────────────────────────
if (cron.validate(CRON_SCHEDULE)) {
  cron.schedule(CRON_SCHEDULE, () => {
    console.log(`⏰ Scheduled run triggered (${CRON_SCHEDULE})`);
    runScreenshots(BROWSERLESS_URL, BROWSERLESS_TOKEN).catch(console.error);
  });
  console.log(`📅 Screenshot schedule: ${CRON_SCHEDULE}`);
}

// ── Start ──────────────────────────────────────────────────────────────────
(async () => {
  await migrateIfNeeded();
  app.listen(PORT, () => {
    console.log(`🚀 Screenshot Monitor running on http://localhost:${PORT}`);
  });
})();
