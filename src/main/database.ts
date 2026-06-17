import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import initSqlJs, { Database } from 'sql.js';

let db: Database | null = null;
const DB_DIR = path.join(app.getPath('userData'), 'data');
const DB_PATH = path.join(DB_DIR, 'chartwatcher.db');

export async function initDatabase(): Promise<void> {
  fs.mkdirSync(DB_DIR, { recursive: true });

  const SQL = await initSqlJs({
    locateFile: (file: string) => {
      // sql.js WASM file location
      return path.join(
        path.dirname(require.resolve('sql.js')),
        '..', 'dist', file
      );
    },
  });

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entry_url TEXT NOT NULL,
      partition_key TEXT,
      auto_start INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS components (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'WholeSite',
      source_id TEXT NOT NULL,
      selectors TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_id) REFERENCES sources(id)
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tabs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      grid_cols INTEGER DEFAULT 12,
      grid_rows INTEGER DEFAULT 8,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS placements (
      id TEXT PRIMARY KEY,
      tab_id TEXT NOT NULL,
      component_id TEXT NOT NULL,
      col INTEGER DEFAULT 0,
      row INTEGER DEFAULT 0,
      col_span INTEGER DEFAULT 3,
      row_span INTEGER DEFAULT 2,
      FOREIGN KEY (tab_id) REFERENCES tabs(id),
      FOREIGN KEY (component_id) REFERENCES components(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Seed defaults if empty
  const count = db.exec("SELECT COUNT(*) FROM sources")[0]?.values[0]?.[0] as number;
  if (count === 0) {
    seedDefaults();
  }

  saveToFile();
  console.log(`[DB] Initialized at ${DB_PATH}`);
}

function seedDefaults(): void {
  if (!db) return;

  const sourceId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const tabId = crypto.randomUUID();

  db.run(
    "INSERT INTO sources (id, name, entry_url, partition_key) VALUES (?, ?, ?, ?)",
    [sourceId, 'SSI iBoard', 'https://iboard.ssi.com.vn/', 'persist:ssi']
  );

  db.run(
    "INSERT INTO workspaces (id, name, is_active) VALUES (?, ?, 1)",
    [workspaceId, 'Default']
  );

  db.run(
    "INSERT INTO tabs (id, workspace_id, name, sort_order) VALUES (?, ?, ?, 0)",
    [tabId, workspaceId, 'Dashboard']
  );

  // Set default theme
  db.run(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('theme', 'colorful')"
  );

  console.log('[DB] Seeded defaults: SSI iBoard + Default workspace');
}

function saveToFile(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function saveDb(): void {
  saveToFile();
}

// ── CRUD helpers ──

export interface Source {
  id: string;
  name: string;
  entry_url: string;
  partition_key: string;
  auto_start: boolean;
}

export interface Component {
  id: string;
  title: string;
  type: 'WholeSite' | 'Crop' | 'Clone';
  source_id: string;
  selectors: string; // JSON array of selector cascades
}

export interface Tab {
  id: string;
  workspace_id: string;
  name: string;
  sort_order: number;
  grid_cols: number;
  grid_rows: number;
}

export interface Placement {
  id: string;
  tab_id: string;
  component_id: string;
  col: number;
  row: number;
  col_span: number;
  row_span: number;
}

export function getAllSources(): Source[] {
  const rows = db!.exec("SELECT id, name, entry_url, partition_key, auto_start FROM sources");
  if (!rows[0]) return [];
  return rows[0].values.map((r: any[]) => ({
    id: r[0] as string,
    name: r[1] as string,
    entry_url: r[2] as string,
    partition_key: r[3] as string,
    auto_start: (r[4] as number) === 1,
  }));
}

export function getAllComponents(): Component[] {
  const rows = db!.exec("SELECT id, title, type, source_id, selectors FROM components");
  if (!rows[0]) return [];
  return rows[0].values.map((r: any[]) => ({
    id: r[0] as string,
    title: r[1] as string,
    type: r[2] as Component['type'],
    source_id: r[3] as string,
    selectors: r[4] as string,
  }));
}

export function getActiveWorkspaceTabs(): Tab[] {
  const rows = db!.exec(`
    SELECT t.id, t.workspace_id, t.name, t.sort_order, t.grid_cols, t.grid_rows
    FROM tabs t
    JOIN workspaces w ON t.workspace_id = w.id
    WHERE w.is_active = 1
    ORDER BY t.sort_order
  `);
  if (!rows[0]) return [];
  return rows[0].values.map((r: any[]) => ({
    id: r[0] as string,
    workspace_id: r[1] as string,
    name: r[2] as string,
    sort_order: r[3] as number,
    grid_cols: r[4] as number,
    grid_rows: r[5] as number,
  }));
}

export function getPlacementsForTab(tabId: string): Placement[] {
  const stmt = db!.prepare("SELECT id, tab_id, component_id, col, row, col_span, row_span FROM placements WHERE tab_id = ?");
  stmt.bind([tabId]);
  const results: Placement[] = [];
  while (stmt.step()) {
    const r = stmt.get();
    results.push({
      id: r[0] as string,
      tab_id: r[1] as string,
      component_id: r[2] as string,
      col: r[3] as number,
      row: r[4] as number,
      col_span: r[5] as number,
      row_span: r[6] as number,
    });
  }
  stmt.free();
  return results;
}

export function upsertSource(source: Source): void {
  db!.run(
    "INSERT OR REPLACE INTO sources (id, name, entry_url, partition_key, auto_start) VALUES (?, ?, ?, ?, ?)",
    [source.id, source.name, source.entry_url, source.partition_key, source.auto_start ? 1 : 0]
  );
  saveToFile();
}

export function upsertComponent(component: Component): void {
  db!.run(
    "INSERT OR REPLACE INTO components (id, title, type, source_id, selectors) VALUES (?, ?, ?, ?, ?)",
    [component.id, component.title, component.type, component.source_id, component.selectors]
  );
  saveToFile();
}

export function upsertPlacement(placement: Placement): void {
  db!.run(
    "INSERT OR REPLACE INTO placements (id, tab_id, component_id, col, row, col_span, row_span) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [placement.id, placement.tab_id, placement.component_id, placement.col, placement.row, placement.col_span, placement.row_span]
  );
  saveToFile();
}

export function deletePlacement(id: string): void {
  db!.run("DELETE FROM placements WHERE id = ?", [id]);
  saveToFile();
}

export function getSetting(key: string): string | null {
  const rows = db!.exec("SELECT value FROM settings WHERE key = ?", [key] as any);
  return (rows[0]?.values[0]?.[0] as string) ?? null;
}

export function setSetting(key: string, value: string): void {
  db!.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
  saveToFile();
}
