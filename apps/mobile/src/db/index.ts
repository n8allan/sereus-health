/**
 * Quereus DB instance (singleton)
 *
 * Branches on USE_OPTIMYSTIC:
 *   true  → CadreService strand database (optimystic-backed, distributed-ready)
 *   false → standalone Database with rn-leveldb plugin (local-only, legacy)
 *
 * Both paths return a Quereus Database with the health schema already applied.
 * Higher-level code calls getDatabase() and doesn't know the backend.
 *
 * Backend-specific imports are lazy (require()) so each path only pulls in
 * its own dependencies.
 */
import type { Database } from '@quereus/quereus';
import { USE_OPTIMYSTIC } from './config';
import { createLogger } from '../util/logger';

const logger = createLogger('DB');

let dbInstance: Database | null = null;
let dbInitPromise: Promise<Database> | null = null;

export async function getDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = USE_OPTIMYSTIC ? initOptimystic() : initLeveldb();

  try {
    return await dbInitPromise;
  } finally {
    dbInitPromise = null;
  }
}

// ---------------------------------------------------------------------------
// Optimystic backend
// ---------------------------------------------------------------------------

async function initOptimystic(): Promise<Database> {
  logger.info('Initializing database via CadreService (optimystic)...');

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { cadreService } = require('../services/CadreService');
  await cadreService.ensureStarted();
  const db: Database = cadreService.getHealthDatabase();
  await db.exec("PRAGMA schema_path = 'app,main'");
  dbInstance = db;
  logger.info('Database ready (optimystic strand)');
  return db;
}

// ---------------------------------------------------------------------------
// LevelDB backend (legacy)
// ---------------------------------------------------------------------------

async function initLeveldb(): Promise<Database> {
  logger.info('Initializing database (leveldb)...');

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Database: DatabaseCtor, registerPlugin } = require('@quereus/quereus');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { plugin: leveldbPlugin } = require('@quereus/plugin-react-native-leveldb');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { LevelDB, LevelDBWriteBatch } = require('rn-leveldb');

  const db: Database = new DatabaseCtor();

  await registerPlugin(db, leveldbPlugin, {
    databaseName: 'quereus',
    moduleName: 'store',
    openFn: ((name: string, createIfMissing: boolean, errorIfExists: boolean) =>
      new LevelDB(name, createIfMissing, errorIfExists)) as unknown as any,
    WriteBatch: LevelDBWriteBatch as unknown as any,
  });

  // Check if schema already exists (persistent DB from prior run)
  let schemaExists = false;
  try {
    const stmt = await db.prepare(
      "SELECT name FROM schema() WHERE type = 'table' AND name = 'types'",
    );
    const row = await stmt.get();
    await stmt.finalize();
    schemaExists = row !== undefined;
  } catch {
    schemaExists = false;
  }

  if (!schemaExists) {
    logger.info('First-time setup: applying schema (leveldb)...');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { applySchema } = require('./schema');
    await applySchema(db);
  }

  dbInstance = db;
  logger.info('Database ready (leveldb)');
  return db;
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

export async function closeDatabase(): Promise<void> {
  if (USE_OPTIMYSTIC) {
    dbInstance = null;
    dbInitPromise = null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { cadreService } = require('../services/CadreService');
    await cadreService.stop();
  } else {
    if (dbInstance) {
      await dbInstance.close();
    }
    dbInstance = null;
    dbInitPromise = null;
  }
}
