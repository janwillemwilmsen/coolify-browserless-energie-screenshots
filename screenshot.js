import "dotenv/config";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";

// Enable stealth mode — patches common automation fingerprints
puppeteer.use(StealthPlugin());

const BROWSERLESS_URL = process.env.BROWSERLESS_URL || "https://browserless.chatle.nl";
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || "";

// URL to screenshot (pass as CLI arg or use default)
const targetUrl = process.argv[2] || "https://www.vattenfall.nl";

// ── Method 1: REST API (no stealth — plain server-side request) ────────────
async function takeScreenshotREST(url) {
  console.log(`\n📸 [REST API] Taking screenshot of: ${url}`);

  const endpoint = `${BROWSERLESS_URL}/screenshot?token=${BROWSERLESS_TOKEN}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      options: {
        fullPage: true,
        type: "png",
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`REST API error: ${response.status} ${response.statusText}\n${body}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const filename = "screenshot-rest.png";
  fs.writeFileSync(filename, buffer);
  console.log(`✅ Saved to ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);
}

// ── Method 2: Puppeteer + Stealth plugin ───────────────────────────────────
async function takeScreenshotStealth(url) {
  console.log(`\n🥷 [Puppeteer + Stealth] Taking screenshot of: ${url}`);

  const wsEndpoint = `${BROWSERLESS_URL.replace("https://", "wss://").replace("http://", "ws://")}?token=${BROWSERLESS_TOKEN}&--disable-blink-features=AutomationControlled`;
  console.log(`   Connecting to: ${wsEndpoint.replace(BROWSERLESS_TOKEN, "***")}`);

  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });

  try {
    const page = await browser.newPage();

    // Set a realistic viewport and user-agent
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    // Set realistic headers
    await page.setExtraHTTPHeaders({
      "Accept-Language": "nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    });

    console.log("   Navigating...");
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // Wait extra time for Cloudflare challenge to resolve
    console.log("   Waiting for potential Cloudflare challenge...");
    await sleep(5000);

    // Check if we're stuck on a Cloudflare challenge page
    const title = await page.title();
    const content = await page.content();
    const isCloudflarePage =
      title.includes("Just a moment") ||
      content.includes("cf-challenge") ||
      content.includes("cf-turnstile") ||
      content.includes("Checking your browser");

    if (isCloudflarePage) {
      console.log("   ⏳ Cloudflare challenge detected — waiting up to 30s for it to resolve...");
      try {
        await page.waitForFunction(
          () => !document.title.includes("Just a moment"),
          { timeout: 30000 }
        );
        // Extra settle time after challenge passes
        await sleep(3000);
        console.log("   ✅ Challenge passed!");
      } catch {
        console.warn("   ⚠️  Challenge did NOT resolve in time — screenshotting whatever is visible");
      }
    } else {
      console.log(`   Page loaded: "${title}"`);
    }

    const filename = "screenshot-stealth.png";
    await page.screenshot({ path: filename, fullPage: true });
    const stats = fs.statSync(filename);
    console.log(`✅ Saved to ${filename} (${(stats.size / 1024).toFixed(1)} KB)`);
  } finally {
    await browser.close();
  }
}

// ── Method 3: REST /unblock endpoint (Browserless paid feature) ────────────
async function takeScreenshotUnblock(url) {
  console.log(`\n🔓 [Unblock API] Taking screenshot of: ${url}`);
  console.log("   Note: This requires a Browserless paid/enterprise license.");

  const endpoint = `${BROWSERLESS_URL}/chromium/unblock?token=${BROWSERLESS_TOKEN}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      browserWSEndpoint: true,
      cookies: false,
      content: false,
      screenshot: true,
      screenshotOptions: {
        fullPage: true,
        type: "png",
        encoding: "base64",
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Unblock API error: ${response.status} ${response.statusText}\n${body}`);
  }

  const data = await response.json();
  if (data.screenshot) {
    const buffer = Buffer.from(data.screenshot, "base64");
    const filename = "screenshot-unblock.png";
    fs.writeFileSync(filename, buffer);
    console.log(`✅ Saved to ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);
  } else {
    console.warn("   ⚠️  No screenshot returned in response");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Browserless Screenshot Test (with Stealth)");
  console.log(`  Target:  ${targetUrl}`);
  console.log(`  Server:  ${BROWSERLESS_URL}`);
  console.log("═══════════════════════════════════════════════════");

  // Method 1: Simple REST screenshot
  try {
    await takeScreenshotREST(targetUrl);
  } catch (err) {
    console.error(`❌ REST API failed: ${err.message}`);
  }

  // Method 2: Puppeteer + Stealth (best free option for Cloudflare)
  try {
    await takeScreenshotStealth(targetUrl);
  } catch (err) {
    console.error(`❌ Stealth failed: ${err.message}`);
  }

  // Method 3: Unblock API (paid feature — will fail on open-source)
  try {
    await takeScreenshotUnblock(targetUrl);
  } catch (err) {
    console.error(`❌ Unblock API failed: ${err.message}`);
  }

  console.log("\n🏁 Done!");
}

main().catch(console.error);
