import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getTargets, getScenarios } from "./db.js";

chromium.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2 },
};

const USER_AGENTS = {
  desktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  mobile:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
};

// ── Run state ──────────────────────────────────────────────────────────────
let currentRun = null;

export function getRunStatus() {
  return currentRun;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function urlToSlug(urlStr) {
  const u = new URL(urlStr);
  let slug = u.hostname.replace(/\./g, "-");
  if (u.pathname && u.pathname !== "/") {
    slug += u.pathname.replace(/\//g, "-").replace(/-$/, "");
  }
  return slug;
}

export function slugToDisplay(slug) {
  return slug.replace(/-/g, ".");
}



function loadConsentTexts() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, "consent-buttons.json"), "utf-8")
    );
  } catch {
    return ["Accept all", "Alles accepteren"];
  }
}

// ── Cookie consent dismissal ───────────────────────────────────────────────
// ── Cookie consent dismissal ───────────────────────────────────────────────
async function dismissCookieConsent(page) {
  const texts = loadConsentTexts();

  // 1. Wait a bit for the banner to actually show up (sometimes it's delayed)
  try {
    await page.waitForFunction(() => {
      const selectors = ['[id*="cookie" i]', '[class*="cookie" i]', '[id*="consent" i]', '[class*="consent" i]', '#usercentrics-root'];
      return selectors.some(s => document.querySelector(s));
    }, { timeout: 3000 }).catch(() => {});
  } catch (e) {}

  const clickOrHideInContext = async (context, consentTexts) => {
    return await context.evaluate((texts) => {
      const xpaths = texts.filter(t => t.startsWith('/') || t.startsWith('('));
      const lowerTexts = texts.filter(t => !t.startsWith('/') && !t.startsWith('(')).map((t) => t.toLowerCase().trim());
      
      const roots = [document];
      const gatherRoots = (root) => {
        try {
          const all = root.querySelectorAll('*');
          for (const el of all) {
            if (el.shadowRoot) {
              roots.push(el.shadowRoot);
              gatherRoots(el.shadowRoot);
            }
          }
        } catch (e) {}
      };
      gatherRoots(document);

      // Try XPaths in every root
      for (const xpath of xpaths) {
        for (const root of roots) {
          try {
            const result = document.evaluate(xpath, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            const el = result.singleNodeValue;
            if (el && typeof el.click === 'function') {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                el.click();
                return "clicked";
              }
            }
          } catch (e) {}
        }
      }

      // Try Text matching in every root
      let bestCandidate = null;
      let highestScore = 0;

      for (const root of roots) {
        const els = Array.from(root.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"], span, div'));
        for (const el of els) {
          const text = (el.textContent || el.innerText || el.value || "").toLowerCase().trim();
          if (!text) continue;

          let score = 0;
          if (lowerTexts.includes(text)) score += 100;
          else if (lowerTexts.some(t => text.includes(t) && text.length < t.length + 10)) score += 50;
          
          if (score === 0) continue;

          const tag = el.tagName.toUpperCase();
          if (tag === 'BUTTON' || tag === 'INPUT' || el.getAttribute('role') === 'button') score += 50;
          if ((tag === 'DIV' || tag === 'SPAN') && !el.onclick && !el.getAttribute('onclick')) score -= 30;

          const rect = el.getBoundingClientRect();
          const isVisible = rect.width > 1 && rect.height > 1 && window.getComputedStyle(el).display !== 'none';
          
          if (isVisible && score > highestScore) {
            highestScore = score;
            bestCandidate = el;
          }
        }
      }

      if (bestCandidate) {
        bestCandidate.click();
        return "clicked";
      }

      // 4. NUCLEAR OPTION: If we find something that LOOKS like a banner but couldn't click it, HIDE IT
      let hidden = false;
      for (const root of roots) {
        const banners = root.querySelectorAll('[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], #usercentrics-root');
        for (const b of banners) {
          const rect = b.getBoundingClientRect();
          if (rect.width > 100 && rect.height > 50) { // Large enough to be a banner
            b.style.display = 'none';
            b.style.opacity = '0';
            b.style.pointerEvents = 'none';
            hidden = true;
          }
        }
      }
      return hidden ? "hidden" : "none";
    }, texts);
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await clickOrHideInContext(page, texts);
    if (result !== "none") {
      await sleep(2500); // Wait longer for animation
      return result;
    }

    for (const frame of page.frames()) {
      try {
        const frameResult = await clickOrHideInContext(frame, texts);
        if (frameResult !== "none") {
          await sleep(2500);
          return frameResult;
        }
      } catch (err) {}
    }
    if (attempt === 0) await sleep(1000);
  }
  return false;
}

// ── Auto-scroll for lazy loading ───────────────────────────────────────────
async function autoScroll(page) {
  try {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 400;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 250);
      });
    });

    // Wait for any remaining lazy loads
    await sleep(2000);

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);
  } catch (e) {
    console.log("[TEST] ⚠️ autoScroll aborted (page likely navigated)");
  }
}

// ── Force page to be fully scrollable ──────────────────────────────────────
async function forceFullPageScroll(page) {
  try {
    await page.evaluate(() => {
      // Remove overflow:hidden from html and body (often set by cookie consent overlays)
      document.documentElement.style.overflow = "visible";
      document.documentElement.style.height = "auto";
      document.body.style.overflow = "visible";
      document.body.style.height = "auto";

      // Also remove position:fixed from any full-page overlay containers
      // that might constrain the page height
      const els = document.querySelectorAll('[style*="overflow: hidden"], [style*="overflow:hidden"]');
      els.forEach((el) => {
        if (el.tagName !== "IFRAME") {
          el.style.overflow = "visible";
        }
      });

      // Remove any max-height constraints on common wrapper elements
      const wrappers = document.querySelectorAll("#__next, #app, #root, .page-wrapper, .site-wrapper, main");
      wrappers.forEach((el) => {
        el.style.overflow = "visible";
        el.style.height = "auto";
        el.style.maxHeight = "none";
      });

      // Remove any position:fixed overlays that block content
      const fixedEls = document.querySelectorAll('[class*="overlay"], [class*="modal"], [class*="backdrop"], [id*="consent"], [id*="cookie"]');
      fixedEls.forEach((el) => {
        const style = window.getComputedStyle(el);
        if (style.position === "fixed" && parseFloat(style.opacity) < 0.1) {
          el.remove();
        }
      });
    });
  } catch (e) {
    console.log("[TEST] ⚠️ forceFullPageScroll aborted (page likely navigated)");
  }
}

// ── Core: screenshot a single page in a single viewport ────────────────────
async function screenshotPage(url, viewportName, browserlessUrl, browserlessToken, scenarioSteps = []) {
  const slug = urlToSlug(url);
  const today = new Date().toISOString().split("T")[0];
  const viewport = VIEWPORTS[viewportName];
  const dir = path.join(__dirname, "screenshots", today, viewportName);
  fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, `${slug}.jpg`);

  const wsEndpoint = `${browserlessUrl
    .replace("https://", "wss://")
    .replace("http://", "ws://")}?token=${browserlessToken}&blockAds=true&stealth=true&--disable-blink-features=AutomationControlled`;

  const browser = await chromium.connectOverCDP(wsEndpoint);
  try {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      userAgent: USER_AGENTS[viewportName],
      extraHTTPHeaders: {
        "Accept-Language": "nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7",
      }
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await sleep(2000);

    // Handle Cloudflare challenge
    const title = await page.title();
    if (title.includes("Just a moment")) {
      console.log("   ⏳ Cloudflare challenge — waiting...");
      try {
        await page.waitForFunction(() => !document.title.includes("Just a moment"), {
          timeout: 30000,
        });
        await sleep(3000);
      } catch {
        console.warn("   ⚠️  Challenge did not resolve");
      }
    }

    // Dismiss cookie consent
    const consented = await dismissCookieConsent(page);
    if (consented) console.log("   🍪 Cookie consent dismissed");

    // ── Execute Custom Scenario or Default ─────────────────────────────────────
    if (scenarioSteps && scenarioSteps.length > 0) {
      console.log(`   🎬 Executing ${scenarioSteps.length} scenario steps...`);
      
      const getLocator = (page, step) => {
        const sel = step.selector || "";
        switch (step.locatorType) {
          case "role":
            if (Array.isArray(step.selector)) return page.getByRole(step.selector[0], step.selector[1]);
            try {
              const parsed = JSON.parse(sel);
              if (Array.isArray(parsed)) return page.getByRole(parsed[0], parsed[1]);
            } catch(e) {}
            return page.getByRole(sel);
          case "text": return page.getByText(sel);
          case "label": return page.getByLabel(sel);
          case "placeholder": return page.getByPlaceholder(sel);
          case "alt": return page.getByAltText(sel);
          case "title": return page.getByTitle(sel);
          case "testid": return page.getByTestId(sel);
          case "css":
          default:
            return page.locator(sel);
        }
      };

      for (const [index, step] of scenarioSteps.entries()) {
        try {
          switch (step.type) {
            case "wait":
              console.log(`      ⏳ wait: ${step.ms}ms`);
              await sleep(Number(step.ms) || 1000);
              break;
            case "waitForSelector": {
              console.log(`      👀 waitForSelector: ${step.selector}`);
              await getLocator(page, step).first().waitFor({ state: "visible", timeout: 15000 });
              break;
            }
            case "click": {
              console.log(`      🖱️ click: ${step.selector}`);
              await getLocator(page, step).first().click({ timeout: 15000 });
              break;
            }
            case "type": {
              console.log(`      ⌨️ type in ${step.selector}: ${step.value}`);
              await getLocator(page, step).first().fill(step.value || "", { timeout: 15000 });
              break;
            }
            case "screenshot":
              console.log(`      📸 custom screenshot step`);
              // Force scrollable again in case scrolling re-triggered any overflow locks
              await forceFullPageScroll(page);
              await sleep(500);
              await page.screenshot({ path: filepath, fullPage: true, type: "jpeg", quality: 50 });
              break;
            default:
              console.log(`      ⚠️ Unknown step type: ${step.type}`);
          }
        } catch (stepErr) {
          console.warn(`      ❌ Step ${index + 1} (${step.type}) failed: ${stepErr.message}`);
        }
      }
      
      // If the scenario didn't explicitly take a screenshot, take one at the end
      if (!scenarioSteps.some(s => s.type === "screenshot")) {
         await forceFullPageScroll(page);
         await page.screenshot({ path: filepath, fullPage: true, type: "jpeg", quality: 50 });
      }
      
    } else {
      // Default Flow (No Scenario)
      // Force the page to be scrollable (remove overflow:hidden etc.)
      await forceFullPageScroll(page);
      await sleep(500);

      // Scroll to load lazy content
      await autoScroll(page);

      // Force scrollable again in case scrolling re-triggered any overflow locks
      await forceFullPageScroll(page);
      await sleep(500);

      // Screenshot
      await page.screenshot({ path: filepath, fullPage: true, type: "jpeg", quality: 50 });
    }
    const size = fs.statSync(filepath).size;
    console.log(`   ✅ ${(size / 1024).toFixed(0)} KB`);
    return { url, slug, viewport: viewportName, success: true, size };
  } finally {
    await browser.close();
  }
}

// ── Run a single URL (both viewports) ──────────────────────────────────────
export async function runSingleScreenshot(url, browserlessUrl, browserlessToken) {
  if (currentRun?.running) {
    throw new Error("A screenshot run is already in progress");
  }

  const slug = urlToSlug(url);
  const totalSteps = Object.keys(VIEWPORTS).length;

  // Try to find if this URL exists in the DB to fetch its scenarios
  let target = null;
  let scenarios = [];
  try {
    target = getTargets().find(t => t.url === url);
    if (target) {
      scenarios = getScenarios(target.id);
    }
  } catch(e) {}
  
  // Use the first scenario if available
  const scenarioSteps = scenarios.length > 0 ? scenarios[0].steps : [];

  currentRun = {
    running: true,
    startedAt: new Date().toISOString(),
    date: new Date().toISOString().split("T")[0],
    progress: { current: 0, total: totalSteps, url, viewport: "" },
    results: [],
  };

  let step = 0;
  for (const viewportName of Object.keys(VIEWPORTS)) {
    step++;
    currentRun.progress = { current: step, total: totalSteps, url, viewport: viewportName };
    console.log(`[${step}/${totalSteps}] ${viewportName} → ${url}`);

    try {
      const result = await screenshotPage(url, viewportName, browserlessUrl, browserlessToken, scenarioSteps);
      currentRun.results.push(result);
    } catch (err) {
      console.error(`   ❌ ${err.message}`);
      currentRun.results.push({ url, slug, viewport: viewportName, success: false, error: err.message });
    }
  }

  currentRun.running = false;
  currentRun.completedAt = new Date().toISOString();
  console.log(`\n🏁 Single-site run complete: ${currentRun.results.filter((r) => r.success).length}/${totalSteps} succeeded`);
  return currentRun;
}

// ── Run all URLs (Full Run) ────────────────────────────────────────────────
export async function runScreenshots(browserlessUrl, browserlessToken) {
  if (currentRun?.running) {
    throw new Error("A screenshot run is already in progress");
  }

  let targets = [];
  try {
    targets = getTargets();
  } catch (err) {
    console.error("Failed to fetch targets from DB:", err);
    throw err;
  }

  if (targets.length === 0) {
    console.log("No URLs configured. Skipping run.");
    return;
  }

  const today = new Date().toISOString().split("T")[0];
  const totalSteps = targets.length * Object.keys(VIEWPORTS).length;

  currentRun = {
    running: true,
    startedAt: new Date().toISOString(),
    date: today,
    progress: { current: 0, total: totalSteps, url: "", viewport: "" },
    results: [],
  };

  let step = 0;

  for (const target of targets) {
    const url = target.url;
    const slug = target.slug;
    
    let scenarios = [];
    try { scenarios = getScenarios(target.id); } catch(e) {}
    const scenarioSteps = scenarios.length > 0 ? scenarios[0].steps : [];

    for (const viewportName of Object.keys(VIEWPORTS)) {
      step++;
      currentRun.progress = { current: step, total: totalSteps, url, viewport: viewportName };
      console.log(`[${step}/${totalSteps}] ${viewportName} → ${url}`);

      try {
        const result = await screenshotPage(url, viewportName, browserlessUrl, browserlessToken, scenarioSteps);
        currentRun.results.push(result);
      } catch (err) {
        console.error(`   ❌ ${err.message}`);
        currentRun.results.push({ url, slug, viewport: viewportName, success: false, error: err.message });
      }
    }
  }

  currentRun.running = false;
  currentRun.completedAt = new Date().toISOString();
  console.log(`\n🏁 Run complete: ${currentRun.results.filter((r) => r.success).length}/${totalSteps} succeeded`);
  return currentRun;
}

// ── Test a Scenario ────────────────────────────────────────────────────────
export async function runTestScenario(url, steps, browserlessUrl, browserlessToken) {
  const wsEndpoint = `${browserlessUrl
    .replace("https://", "wss://")
    .replace("http://", "ws://")}?token=${browserlessToken}&blockAds=true&stealth=true&--disable-blink-features=AutomationControlled`;

  const browser = await chromium.connectOverCDP(wsEndpoint);
  let base64Image = null;

  try {
    const context = await browser.newContext({
      viewport: { width: VIEWPORTS.desktop.width, height: VIEWPORTS.desktop.height },
      deviceScaleFactor: VIEWPORTS.desktop.deviceScaleFactor,
      userAgent: USER_AGENTS.desktop,
      extraHTTPHeaders: {
        "Accept-Language": "nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7",
      }
    });
    const page = await context.newPage();

    console.log(`[TEST] → ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await sleep(2000);

    const title = await page.title();
    if (title.includes("Just a moment")) {
      console.log("[TEST] ⏳ Cloudflare challenge — waiting...");
      try {
        await page.waitForFunction(() => !document.title.includes("Just a moment"), {
          timeout: 30000,
        });
        await sleep(3000);
      } catch {}
    }

    await dismissCookieConsent(page);
    await forceFullPageScroll(page);
    await sleep(500);

    const getLocator = (page, step) => {
      const sel = step.selector || "";
      switch (step.locatorType) {
        case "role":
          if (Array.isArray(step.selector)) return page.getByRole(step.selector[0], step.selector[1]);
          try {
            const parsed = JSON.parse(sel);
            if (Array.isArray(parsed)) return page.getByRole(parsed[0], parsed[1]);
          } catch(e) {}
          return page.getByRole(sel);
        case "text": return page.getByText(sel);
        case "label": return page.getByLabel(sel);
        case "placeholder": return page.getByPlaceholder(sel);
        case "alt": return page.getByAltText(sel);
        case "title": return page.getByTitle(sel);
        case "testid": return page.getByTestId(sel);
        case "css":
        default: return page.locator(sel);
      }
    };

    if (steps && steps.length > 0) {
      console.log(`[TEST] 🎬 Executing ${steps.length} scenario steps...`);
      for (const [index, step] of steps.entries()) {
        try {
          switch (step.type) {
            case "wait":
              console.log(`[TEST] ⏳ wait: ${step.ms}ms`);
              await sleep(Number(step.ms) || 1000);
              break;
            case "waitForSelector": {
              console.log(`[TEST] 👀 waitForSelector: ${step.selector}`);
              await getLocator(page, step).first().waitFor({ state: "visible", timeout: 15000 });
              break;
            }
            case "click": {
              console.log(`[TEST] 🖱️ click: ${step.selector}`);
              await getLocator(page, step).first().click({ timeout: 15000 });
              break;
            }
            case "type": {
              console.log(`[TEST] ⌨️ type in ${step.selector}: ${step.value}`);
              await getLocator(page, step).first().fill(step.value || "", { timeout: 15000 });
              break;
            }
            case "screenshot":
              console.log(`[TEST] 📸 custom screenshot step`);
              await forceFullPageScroll(page);
              await sleep(500);
              const buffer = await page.screenshot({ fullPage: true, type: "jpeg", quality: 50 });
              base64Image = buffer.toString("base64");
              break;
            default:
              console.log(`[TEST] ⚠️ Unknown step type: ${step.type}`);
          }
        } catch (stepErr) {
          console.warn(`[TEST] ❌ Step ${index + 1} (${step.type}) failed: ${stepErr.message}`);
        }
      }
    } else {
      await autoScroll(page);
    }

    if (!base64Image) {
       await forceFullPageScroll(page);
       const buffer = await page.screenshot({ fullPage: true, type: "jpeg", quality: 50 });
       base64Image = buffer.toString("base64");
    }
    
    return { success: true, imageBase64: base64Image };
  } catch (err) {
    console.error(`[TEST] ❌ Failed: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}
