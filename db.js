import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseStringPromise } from "xml2js";
import { urlToSlug } from "./screenshot-worker.js"; // We need this exported or just duplicate it here

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "data.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// ── Schema Initialization ──────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    brand TEXT DEFAULT '',
    type TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    steps TEXT NOT NULL DEFAULT '[]', -- JSON array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(target_id) REFERENCES targets(id) ON DELETE CASCADE
  );
`);

// ── Data Migration (XML -> DB) ─────────────────────────────────────────────
export async function migrateIfNeeded() {
  const sitemapPath = path.join(__dirname, "sitemap.xml");
  if (fs.existsSync(sitemapPath)) {
    const rowCount = db.prepare("SELECT COUNT(*) as count FROM targets").get().count;
    if (rowCount === 0) {
      console.log("📦 Migrating URLs from sitemap.xml to SQLite...");
      try {
        const xml = fs.readFileSync(sitemapPath, "utf-8");
        const result = await parseStringPromise(xml);
        const urls = result.urlset.url.map((u) => u.loc[0]);
        
        const insertTarget = db.prepare("INSERT OR IGNORE INTO targets (url, slug) VALUES (?, ?)");
        
        const insertMany = db.transaction((urlsToInsert) => {
          for (const url of urlsToInsert) {
            const slug = urlToSlug(url);
            insertTarget.run(url, slug);
          }
        });
        
        insertMany(urls);
        console.log(`✅ Migrated ${urls.length} URLs to SQLite. You can safely delete sitemap.xml now.`);
        
        // Optionally rename sitemap so it doesn't run again, or just let the COUNT(*) > 0 check handle it.
        fs.renameSync(sitemapPath, sitemapPath + ".migrated");
      } catch (err) {
        console.error("❌ Migration failed:", err);
      }
    }
  }
}

// ── Target Operations ──────────────────────────────────────────────────────
export function getTargets() {
  return db.prepare("SELECT * FROM targets ORDER BY id ASC").all();
}

export function getTarget(id) {
  return db.prepare("SELECT * FROM targets WHERE id = ?").get(id);
}

export function addTarget(url, brand = '', type = '') {
  try {
    const slug = urlToSlug(url);
    
    const result = db.prepare(
      "INSERT INTO targets (url, slug, brand, type) VALUES (?, ?, ?, ?)"
    ).run(url, slug, brand, type);
    
    return { id: result.lastInsertRowid, url, slug, brand, type };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error("URL already exists");
    }
    throw err;
  }
}

export function updateTarget(id, updates) {
  const { url, brand, type } = updates;
  
  // Recompute slug if URL changes
  let slug;
  if (url) {
    slug = urlToSlug(url);
  }

  const stmt = db.prepare(`
    UPDATE targets 
    SET url = COALESCE(?, url), 
        slug = COALESCE(?, slug),
        brand = COALESCE(?, brand), 
        type = COALESCE(?, type)
    WHERE id = ?
  `);
  
  stmt.run(url || null, slug || null, brand !== undefined ? brand : null, type !== undefined ? type : null, id);
  return getTarget(id);
}

export function deleteTarget(id) {
  db.prepare("DELETE FROM targets WHERE id = ?").run(id);
  return true;
}

// ── Scenario Operations ────────────────────────────────────────────────────
export function getScenarios(targetId) {
  const scenarios = db.prepare("SELECT * FROM scenarios WHERE target_id = ? ORDER BY created_at ASC").all(targetId);
  // Parse steps back into objects
  return scenarios.map(s => ({ ...s, steps: JSON.parse(s.steps) }));
}

export function addScenario(targetId, name, stepsArray = []) {
  const stepsJson = JSON.stringify(stepsArray);
  const result = db.prepare(
    "INSERT INTO scenarios (target_id, name, steps) VALUES (?, ?, ?)"
  ).run(targetId, name, stepsJson);
  
  return { id: result.lastInsertRowid, targetId, name, steps: stepsArray };
}

export function updateScenario(id, name, stepsArray) {
  const stepsJson = JSON.stringify(stepsArray);
  db.prepare("UPDATE scenarios SET name = ?, steps = ? WHERE id = ?").run(name, stepsJson, id);
  return { id, name, steps: stepsArray };
}

export function deleteScenario(id) {
  db.prepare("DELETE FROM scenarios WHERE id = ?").run(id);
  return true;
}

export default db;
