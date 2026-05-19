import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getTargets, getScenarios } from "./db.js";

chromium.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAYOUT_DEBUG = /^(1|true|yes|on)$/i.test(process.env.SCREENSHOT_DEBUG_LAYOUT || "");

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

function debugLayout(message, payload = null) {
  if (!LAYOUT_DEBUG) return;
  if (payload == null) {
    console.log(`[DEBUG][layout] ${message}`);
    return;
  }
  console.log(`[DEBUG][layout] ${message}: ${JSON.stringify(payload)}`);
}

let consentTextsCache = null;

function getLocator(page, step) {
  const sel = step?.selector || "";
  switch (step?.locatorType) {
    case "role":
      if (Array.isArray(step.selector)) return page.getByRole(step.selector[0], step.selector[1]);
      try {
        const parsed = JSON.parse(sel);
        if (Array.isArray(parsed)) return page.getByRole(parsed[0], parsed[1]);
      } catch (e) {}
      return page.getByRole(sel);
    case "text":
      return page.getByText(sel);
    case "label":
      return page.getByLabel(sel);
    case "placeholder":
      return page.getByPlaceholder(sel);
    case "alt":
      return page.getByAltText(sel);
    case "title":
      return page.getByTitle(sel);
    case "testid":
      return page.getByTestId(sel);
    case "css":
    default:
      return page.locator(sel);
  }
}

function getStepLocator(page, step) {
  const locator = getLocator(page, step);
  const nthRaw = step?.nth;
  if (nthRaw === undefined || nthRaw === null || nthRaw === "") {
    return locator.first();
  }

  const nth = Number(nthRaw);
  if (Number.isInteger(nth) && nth >= 0) {
    return locator.nth(nth);
  }

  return locator.first();
}

function resolveScenarioSteps(scenarios = [], url = "") {
  if (!Array.isArray(scenarios) || scenarios.length === 0) return [];
  if (scenarios.length > 1) {
    console.warn(
      `   ⚠️ Multiple scenarios found for ${url || "target"}; using only the first scenario as configured`
    );
  }
  const firstSteps = scenarios[0]?.steps;
  return Array.isArray(firstSteps) ? firstSteps : [];
}



function loadConsentTexts() {
  if (consentTextsCache) return consentTextsCache;
  try {
    consentTextsCache = JSON.parse(
      fs.readFileSync(path.join(__dirname, "consent-buttons.json"), "utf-8")
    );
    return consentTextsCache;
  } catch {
    consentTextsCache = ["Accept all", "Alles accepteren"];
    return consentTextsCache;
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
      const describeEl = (el) => {
        const tag = (el.tagName || "node").toLowerCase();
        const id = el.id ? `#${el.id}` : "";
        const className =
          typeof el.className === "string" && el.className.trim()
            ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
            : "";
        return `${tag}${id}${className}`;
      };

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
                return { action: "clicked", method: "xpath", target: describeEl(el), xpath };
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
        return { action: "clicked", method: "text", target: describeEl(bestCandidate) };
      }

      // 4. NUCLEAR OPTION: If we find something that LOOKS like a banner but couldn't click it, HIDE IT
      let hidden = false;
      const hiddenTargets = [];
      for (const root of roots) {
        const banners = root.querySelectorAll('[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], #usercentrics-root');
        for (const b of banners) {
          const rect = b.getBoundingClientRect();
          if (rect.width > 100 && rect.height > 50) { // Large enough to be a banner
            b.style.display = 'none';
            b.style.opacity = '0';
            b.style.pointerEvents = 'none';
            hidden = true;
            hiddenTargets.push(describeEl(b));
          }
        }
      }
      return hidden
        ? { action: "hidden", count: hiddenTargets.length, targets: hiddenTargets.slice(0, 8) }
        : { action: "none" };
    }, texts);
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await clickOrHideInContext(page, texts);
    if (result.action !== "none") {
      debugLayout("cookie-consent main frame", result);
      await sleep(2500); // Wait longer for animation
      return result.action;
    }

    for (const frame of page.frames()) {
      try {
        const frameResult = await clickOrHideInContext(frame, texts);
        if (frameResult.action !== "none") {
          debugLayout("cookie-consent child frame", frameResult);
          await sleep(2500);
          return frameResult.action;
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
async function forceFullPageScroll(page, debugContext = "") {
  try {
    const debugResult = await page.evaluate(() => {
      const describeEl = (el) => {
        const tag = (el.tagName || "node").toLowerCase();
        const id = el.id ? `#${el.id}` : "";
        const className =
          typeof el.className === "string" && el.className.trim()
            ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
            : "";
        return `${tag}${id}${className}`;
      };

      // Remove overflow:hidden from html and body (often set by cookie consent overlays)
      document.documentElement.style.overflowY = "visible";
      document.documentElement.style.overflowX = "hidden";
      document.documentElement.style.height = "auto";
      document.body.style.overflowY = "visible";
      document.body.style.overflowX = "hidden";
      document.body.style.height = "auto";

      // Constrain the page to the viewport width so no child can make it wider.
      // Use maxWidth rather than width so we don't break percentage layouts.
      document.documentElement.style.maxWidth = window.innerWidth + 'px';
      document.body.style.maxWidth = window.innerWidth + 'px';

      // Reset any modal-induced body padding (e.g. 17px scrollbar compensation)
      // that causes content to appear off-center when a modal is open.
      document.body.style.paddingRight = '';
      document.body.style.paddingLeft = '';
      document.documentElement.style.paddingRight = '';

      const changedOverflowTargets = [];

      // For elements other than html/body that have inline overflow:hidden set
      // (typically by the cookie-modal framework), clear the inline override so
      // CSS takes over.  Setting an explicit value here creates a new BFC that
      // can collapse flex/grid centering and produce a 4000 px canvas.
      const isAriaHelper = (el) => {
        const id = (el.id || '').toLowerCase();
        return id.includes('announcer') || id.includes('aria-live') || id.includes('live-region');
      };

      const els = document.querySelectorAll('[style*="overflow: hidden"], [style*="overflow:hidden"]');
      els.forEach((el) => {
        if (el === document.documentElement || el === document.body) return; // handled above
        if (el.tagName !== "IFRAME" && !isAriaHelper(el)) {
          el.style.overflow = ""; // restore CSS default
          changedOverflowTargets.push(describeEl(el));
        }
      });

      // Remove any max-height constraints on common wrapper elements.
      // Do NOT touch overflow here – setting overflowX:hidden on a flex/grid
      // container creates a new BFC that collapses centering and widens the page.
      const wrappers = document.querySelectorAll("#__next, #app, #root, .page-wrapper, .site-wrapper, main");
      const wrapperTargets = [];
      wrappers.forEach((el) => {
        el.style.height = "auto";
        el.style.maxHeight = "none";
        wrapperTargets.push(describeEl(el));
      });

      // Hide low-opacity fixed overlays without removing them from the DOM.
      // Using display:none instead of el.remove() prevents React/Vue from
      // detecting the removal and triggering re-renders that break page layout.
      const fixedEls = document.querySelectorAll('[class*="overlay"], [class*="modal"], [class*="backdrop"], [id*="consent"], [id*="cookie"]');
      const removedFixedTargets = [];
      fixedEls.forEach((el) => {
        const style = window.getComputedStyle(el);
        if (style.position === "fixed" && parseFloat(style.opacity) < 0.1) {
          removedFixedTargets.push(describeEl(el));
          el.style.display = 'none';
          el.style.pointerEvents = 'none';
        }
      });

      return {
        htmlBodyAdjusted: true,
        overflowUnlockedCount: changedOverflowTargets.length,
        overflowUnlockedSample: changedOverflowTargets.slice(0, 8),
        wrappersAdjustedCount: wrapperTargets.length,
        wrappersAdjustedSample: wrapperTargets.slice(0, 8),
        fixedRemovedCount: removedFixedTargets.length,
        fixedRemovedSample: removedFixedTargets.slice(0, 8),
        metrics: {
          bodyScrollHeight: document.body ? document.body.scrollHeight : null,
          bodyScrollWidth: document.body ? document.body.scrollWidth : null,
          htmlScrollHeight: document.documentElement ? document.documentElement.scrollHeight : null,
          htmlScrollWidth: document.documentElement ? document.documentElement.scrollWidth : null,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
        },
      };
    });

    debugLayout(`forceFullPageScroll ${debugContext}`.trim(), debugResult);
  } catch (e) {
    console.log("[TEST] ⚠️ forceFullPageScroll aborted (page likely navigated)");
  }
}

async function captureJpegScreenshot(page, { path: outputPath, fullPage = true } = {}) {
  if (!fullPage) {
    return page.screenshot({ path: outputPath, fullPage: false, type: "jpeg", quality: 50 });
  }

  const dims = await page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;
    const viewportWidth = window.innerWidth;
    const contentHeight = Math.max(
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      html ? html.scrollHeight : 0,
      html ? html.offsetHeight : 0
    );
    const contentWidth = Math.max(
      body ? body.scrollWidth : 0,
      html ? html.scrollWidth : 0
    );

    const selectContentBox = () => {
      const selectors = ["main", "[role='main']", "#app main", "#__next main", ".page-wrapper", ".site-wrapper"];
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 320 || rect.height < 120) continue;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        return {
          selector,
          left: Math.max(0, rect.left),
          width: Math.min(viewportWidth, rect.width),
        };
      }
      return null;
    };

    return {
      viewportWidth,
      contentHeight,
      contentWidth,
      contentBox: selectContentBox(),
    };
  });

  if (dims.contentWidth > dims.viewportWidth + 2) {
    const hasNarrowContentBox =
      dims.contentBox &&
      Number.isFinite(dims.contentBox.width) &&
      dims.contentBox.width > 320 &&
      dims.contentBox.width < dims.viewportWidth - 80;

    if (hasNarrowContentBox) {
      const clipX = Math.max(0, Math.floor(dims.contentBox.left));
      const clipWidth = Math.max(
        1,
        Math.min(
          Math.floor(dims.contentBox.width),
          Math.floor(dims.viewportWidth - clipX)
        )
      );

      debugLayout("capture fallback to content-column clip", {
        ...dims,
        clip: {
          x: clipX,
          width: clipWidth,
        },
      });

      return page.screenshot({
        path: outputPath,
        type: "jpeg",
        quality: 50,
        clip: {
          x: clipX,
          y: 0,
          width: clipWidth,
          height: Math.max(1, Math.floor(dims.contentHeight)),
        },
      });
    }

    // Use the content-box left offset as the clip origin so that a wide page
    // (e.g. 4000 px) with the main column starting at x > 0 is still captured
    // correctly.  Fall back to 0 when there is no content box or it starts
    // flush with the left edge.
    const fallbackX = (dims.contentBox && dims.contentBox.left > 10)
      ? Math.floor(dims.contentBox.left)
      : 0;

    debugLayout("capture fallback to viewport-width clip", { ...dims, fallbackX });
    return page.screenshot({
      path: outputPath,
      type: "jpeg",
      quality: 50,
      clip: {
        x: fallbackX,
        y: 0,
        width: Math.max(1, Math.floor(dims.viewportWidth)),
        height: Math.max(1, Math.floor(dims.contentHeight)),
      },
    });
  }

  return page.screenshot({ path: outputPath, fullPage: true, type: "jpeg", quality: 50 });
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
    .replace("http://", "ws://")}?token=${browserlessToken}&blockAds=true&stealth=true&--disable-blink-features=AutomationControlled&--window-size=${viewport.width},${viewport.height}`;

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
      const stepFailures = [];

      for (const [index, step] of scenarioSteps.entries()) {
        try {
          switch (step.type) {
            case "wait":
              console.log(`      ⏳ wait: ${step.ms}ms`);
              await sleep(Number(step.ms) || 1000);
              break;
            case "waitForSelector": {
              console.log(`      👀 waitForSelector: ${step.selector}`);
              await getStepLocator(page, step).waitFor({ state: "visible", timeout: 15000 });
              break;
            }
            case "click": {
              console.log(`      🖱️ click: ${step.selector}`);
              await getStepLocator(page, step).click({ timeout: 15000 });
              break;
            }
            case "type": {
              const typeSummary = step.value == null ? "[empty]" : `[redacted:${String(step.value).length}]`;
              console.log(`      ⌨️ type in ${step.selector}: ${typeSummary}`);
              await getStepLocator(page, step).fill(step.value || "", { timeout: 15000 });
              break;
            }
            case "screenshot":
              console.log(`      📸 custom screenshot step`);
              // Force scrollable again in case scrolling re-triggered any overflow locks
              await forceFullPageScroll(page, `${viewportName} ${url} scenario-screenshot-step`);
              await sleep(500);
              await captureJpegScreenshot(page, { path: filepath, fullPage: true });
              break;
            default:
              console.log(`      ⚠️ Unknown step type: ${step.type}`);
          }
        } catch (stepErr) {
          console.warn(`      ❌ Step ${index + 1} (${step.type}) failed: ${stepErr.message}`);
          stepFailures.push({ index: index + 1, type: step.type, error: stepErr.message });
        }
      }
      
      // If the scenario didn't explicitly take a screenshot, take one at the end
      if (!scenarioSteps.some(s => s.type === "screenshot")) {
        await forceFullPageScroll(page, `${viewportName} ${url} scenario-final-shot`);
        await captureJpegScreenshot(page, { path: filepath, fullPage: true });
      }

      if (stepFailures.length > 0) {
        const firstFailure = stepFailures[0];
        throw new Error(
          `Scenario failed (${stepFailures.length} step error(s)). First failure: step ${firstFailure.index} (${firstFailure.type}) - ${firstFailure.error}`
        );
      }
      
    } else {
      // Default Flow (No Scenario)
      // Force the page to be scrollable (remove overflow:hidden etc.)
      await forceFullPageScroll(page, `${viewportName} ${url} default-before-scroll`);
      await sleep(500);

      // Scroll to load lazy content
      await autoScroll(page);

      // Force scrollable again in case scrolling re-triggered any overflow locks
      await forceFullPageScroll(page, `${viewportName} ${url} default-after-scroll`);
      await sleep(500);

      // Screenshot
      await captureJpegScreenshot(page, { path: filepath, fullPage: true });
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
  
  // Use only one scenario per URL.
  const scenarioSteps = resolveScenarioSteps(scenarios, url);

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
    const scenarioSteps = resolveScenarioSteps(scenarios, url);

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
export async function runTestScenario(url, steps, customViewport, browserlessUrl, browserlessToken) {
  let viewportSettings = VIEWPORTS.desktop;
  if (customViewport) {
    if (customViewport === "mobile") viewportSettings = VIEWPORTS.mobile;
    else if (customViewport === "tablet") viewportSettings = { width: 1024, height: 800, deviceScaleFactor: 1 };
  }

  const wsEndpoint = `${browserlessUrl
    .replace("https://", "wss://")
    .replace("http://", "ws://")}?token=${browserlessToken}&blockAds=true&stealth=true&--disable-blink-features=AutomationControlled&--window-size=${viewportSettings.width},${viewportSettings.height}`;

  const browser = await chromium.connectOverCDP(wsEndpoint);
  let base64Image = null;
  const selectedUserAgent = customViewport === "mobile" ? USER_AGENTS.mobile : USER_AGENTS.desktop;

  try {
    const context = await browser.newContext({
      viewport: { width: viewportSettings.width, height: viewportSettings.height },
      deviceScaleFactor: viewportSettings.deviceScaleFactor,
      userAgent: selectedUserAgent,
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
    await forceFullPageScroll(page, `[TEST] ${customViewport || "desktop"} ${url} before-steps`);
    await sleep(500);

    if (steps && steps.length > 0) {
      console.log(`[TEST] 🎬 Executing ${steps.length} scenario steps...`);
      const stepFailures = [];
      for (const [index, step] of steps.entries()) {
        try {
          switch (step.type) {
            case "wait":
              console.log(`[TEST] ⏳ wait: ${step.ms}ms`);
              await sleep(Number(step.ms) || 1000);
              break;
            case "waitForSelector": {
              console.log(`[TEST] 👀 waitForSelector: ${step.selector}`);
              await getStepLocator(page, step).waitFor({ state: "visible", timeout: 15000 });
              break;
            }
            case "click": {
              console.log(`[TEST] 🖱️ click: ${step.selector}`);
              await getStepLocator(page, step).click({ timeout: 15000 });
              break;
            }
            case "type": {
              const typeSummary = step.value == null ? "[empty]" : `[redacted:${String(step.value).length}]`;
              console.log(`[TEST] ⌨️ type in ${step.selector}: ${typeSummary}`);
              await getStepLocator(page, step).fill(step.value || "", { timeout: 15000 });
              break;
            }
            case "screenshot": {
              console.log(`[TEST] 📸 custom screenshot step`);
              const isFullPage = step.fullPage !== false; // defaults to true if not specified
              if (isFullPage) {
                await forceFullPageScroll(page, `[TEST] ${customViewport || "desktop"} ${url} screenshot-step`);
              }
              await sleep(500);
              const buffer = await captureJpegScreenshot(page, { fullPage: isFullPage });
              base64Image = buffer.toString("base64");
              break;
            }
            default:
              console.log(`[TEST] ⚠️ Unknown step type: ${step.type}`);
          }
        } catch (stepErr) {
          console.warn(`[TEST] ❌ Step ${index + 1} (${step.type}) failed: ${stepErr.message}`);
          stepFailures.push({ index: index + 1, type: step.type, error: stepErr.message });
        }
      }

      if (stepFailures.length > 0) {
        const firstFailure = stepFailures[0];
        return {
          success: false,
          error: `Scenario failed (${stepFailures.length} step error(s)). First failure: step ${firstFailure.index} (${firstFailure.type}) - ${firstFailure.error}`,
        };
      }
    } else {
      await autoScroll(page);
    }

    if (!base64Image) {
       await forceFullPageScroll(page, `[TEST] ${customViewport || "desktop"} ${url} fallback-shot`);
       const buffer = await captureJpegScreenshot(page, { fullPage: true });
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
