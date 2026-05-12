/**
 * CadreService — singleton wrapper around @sereus/cadre-core CadreNode.
 *
 * Boots at first data access.  Creates a local health strand via addStrand()
 * so health data is stored in optimystic from the start.  Adding remote nodes
 * later automatically distributes the data.
 *
 * Authority keys, CadrePeer registration, and control-DB strand entries are
 * deferred until the user adds a second node (see STATUS.md Step 3).
 *
 * References:
 *   sereus/packages/cadre-core/README.md
 *   sereus/docs/cadre-architecture.md
 */

import {
  CadreNode,
  type CadreNodeConfig,
  type CadreNodeEvents,
  type ControlDatabase,
  type StrandInstance,
  type StrandMode,
} from '@sereus/cadre-core';
import { webSockets } from '@libp2p/websockets';
import { LevelDBRawStorage, openOptimysticRNDb } from '@optimystic/db-p2p-storage-rn';
import { LevelDB, LevelDBWriteBatch } from 'rn-leveldb';
import type { Database } from '@quereus/quereus';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SCHEMA_SQL from '../../../../design/specs/domain/schema.qsql';
import { createLogger } from '../util/logger';
import { loadOrCreatePeerKey } from './peerIdentity';

const logger = createLogger('CadreService');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAPP_ID = 'org.sereus.health';
const SAPP_VERSION = '1.0';
const PARTY_ID_KEY = '@sereus/partyId';
const STRAND_ID_KEY = '@sereus/healthStrandId';
const BOOTSTRAP_NODES: string[] = [];

/**
 * Per-strand lifecycle mode persists in AsyncStorage under this key prefix.
 * A fresh strand starts in `'bootstrap'` mode (local transactor, no network I/O);
 * the first remote-peer enrollment for the strand flips it to `'networked'`.
 *
 * TODO: once the control-DB strand row exists (STATUS.md Step 3) migrate this
 * onto the row and drop the AsyncStorage mirror.
 */
const strandModeKey = (strandId: string) => `@sereus/strand/${strandId}/mode`;

function isStrandMode(value: string | null): value is StrandMode {
  return value === 'bootstrap' || value === 'networked';
}

// ---------------------------------------------------------------------------
// Health schema
// ---------------------------------------------------------------------------

/**
 * Extract the inner DDL from schema.qsql.
 * schema.qsql wraps everything in `declare schema main { ... }`.
 * StrandDatabase wraps it in `declare schema App { ... }; apply schema App;`.
 * We strip the outer wrapper so StrandDatabase can re-wrap.
 */
function extractInnerDDL(schemaSql: string): string {
  return schemaSql
    .replace(/^\s*--[^\n]*\n/gm, '')        // strip comment lines
    .replace(/^declare\s+schema\s+\w+\s*\{/m, '') // strip opening
    .replace(/\}\s*$/, '')                    // strip closing brace
    .trim();
}

const HEALTH_SCHEMA_DDL = extractInnerDDL(SCHEMA_SQL);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventHandler<T> = (payload: T) => void;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class CadreServiceImpl {
  private node: CadreNode | null = null;
  private healthStrand: StrandInstance | null = null;
  private _partyId: string | null = null;
  private _startError: string | null = null;
  private _startPromise: Promise<void> | null = null;

  /** Whether the CadreNode is running. */
  get isRunning(): boolean {
    return this.node?.isRunning ?? false;
  }

  /** Party ID for this network (null before start). */
  get partyId(): string | null {
    return this._partyId;
  }

  /** Peer ID of this node (null before start). */
  get peerId(): string | undefined {
    return this.node?.peerId?.toString();
  }

  /** Last startup error, if any. */
  get startError(): string | null {
    return this._startError;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Ensure the CadreNode is started and the health strand is ready.
   * Idempotent — concurrent callers share the same promise.
   */
  async ensureStarted(): Promise<void> {
    if (this.healthStrand) return;
    if (this._startPromise) return this._startPromise;
    this._startPromise = this.doStart();
    try {
      await this._startPromise;
    } catch {
      this._startPromise = null;
      throw new Error(this._startError ?? 'CadreService failed to start');
    }
  }

  private async doStart(): Promise<void> {
    this._startError = null;

    const t0 = Date.now();
    const lap = (label: string, since: number) =>
      logger.info(`timing: ${label} took ${Date.now() - since}ms (total ${Date.now() - t0}ms)`);

    try {
      const tParty = Date.now();
      this._partyId = await this.getOrCreateValue(PARTY_ID_KEY);
      logger.info('Party ID:', this._partyId);
      lap('partyId load', tParty);

      const tKey = Date.now();
      const privateKey = await loadOrCreatePeerKey();
      lap('loadOrCreatePeerKey', tKey);

      const config: CadreNodeConfig = {
        privateKey,
        controlNetwork: {
          partyId: this._partyId,
          bootstrapNodes: BOOTSTRAP_NODES,
        },
        profile: 'transaction',
        strandFilter: { mode: 'sAppId', sAppId: SAPP_ID },
        storage: {
          provider: (strandId: string) => new LevelDBRawStorage(
            openOptimysticRNDb({
              openFn: (name, createIfMissing, errorIfExists) =>
                new LevelDB(name, createIfMissing, errorIfExists),
              WriteBatch: LevelDBWriteBatch,
              name: `optimystic-${strandId}`,
            }),
          ),
        },
        network: {
          // RN requires explicit transports (no TCP).  WebSockets satisfies
          // the constructor; actual peer communication is deferred until the
          // user adds remote nodes (Step 3).
          transports: [webSockets()],
          listenAddrs: [],
        },
      };

      logger.info('Creating CadreNode...');
      this.node = new CadreNode(config);
      logger.info('Starting CadreNode...');
      const tNode = Date.now();
      await this.node.start();
      lap('cadreNode.start (control libp2p + control DB)', tNode);
      logger.info('CadreNode started. Peer ID:', this.node.peerId?.toString());

      // Create the health strand.  addStrand() does NOT write to the control
      // database — it starts a strand locally with its own libp2p node and
      // StrandDatabase.  No authority key required.
      const strandId = await this.getOrCreateValue(STRAND_ID_KEY);
      const strandMode = await this.getOrCreateStrandMode(strandId);
      logger.info('Adding health strand:', strandId, 'mode:', strandMode);

      const tStrand = Date.now();
      this.healthStrand = await this.node.addStrand({
        strandRow: {
          Id: strandId,
          MemberPrivateKey: null,
          Type: 'o', // open strand
        },
        sAppConfig: {
          id: SAPP_ID,
          version: SAPP_VERSION,
          schema: HEALTH_SCHEMA_DDL,
          signature: '', // Placeholder — signing enforced when strand is registered in control DB
        },
        mode: strandMode,
      });
      lap('addStrand (strand libp2p + strand DB + schema apply)', tStrand);
      logger.info('Health strand ready. Database available:', !!this.healthStrand?.database);
      lap('CadreService.doStart total', t0);
    } catch (err) {
      this._startError = err instanceof Error ? err.message : String(err);
      logger.error('doStart failed:', this._startError);
      throw err;
    }
  }

  /** Stop the CadreNode gracefully.  Idempotent. */
  async stop(): Promise<void> {
    if (!this.node) return;
    this.healthStrand = null;
    await this.node.stop();
    this.node = null;
    this._startPromise = null;
  }

  // -----------------------------------------------------------------------
  // Data access
  // -----------------------------------------------------------------------

  /**
   * Return the health strand's Quereus Database for SQL queries.
   * Call ensureStarted() first.
   */
  getHealthDatabase(): Database {
    if (!this.healthStrand?.database) {
      throw new Error('Health strand not initialized. Call ensureStarted() first.');
    }
    return this.healthStrand.database.getDatabase();
  }

  /** Return the control database (for Sereus Connections screen). */
  get controlDatabase(): ControlDatabase | null {
    return this.node?.getControlDatabase() ?? null;
  }

  /** Return the CadreNode (for advanced use, e.g., enrollment). */
  get cadreNode(): CadreNode | null {
    return this.node;
  }

  /** Return multiaddrs of this node (empty if not started). */
  getMultiaddrs(): string[] {
    return this.node?.getMultiaddrs() ?? [];
  }

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  on<K extends keyof CadreNodeEvents>(
    event: K,
    handler: EventHandler<CadreNodeEvents[K]>,
  ): void {
    this.node?.on(event, handler);
  }

  off<K extends keyof CadreNodeEvents>(
    event: K,
    handler: EventHandler<CadreNodeEvents[K]>,
  ): void {
    this.node?.off(event, handler);
  }

  // -----------------------------------------------------------------------
  // Persistence helpers
  // -----------------------------------------------------------------------

  private async getOrCreateValue(key: string): Promise<string> {
    const stored = await AsyncStorage.getItem(key);
    if (stored) return stored;
    const id = generateId();
    await AsyncStorage.setItem(key, id);
    return id;
  }

  /**
   * Read the persisted lifecycle mode for a strand; if missing, default to
   * `'bootstrap'` and persist.  Fresh creates always start in bootstrap so a
   * solo node can initialize without network round trips.
   */
  private async getOrCreateStrandMode(strandId: string): Promise<StrandMode> {
    const key = strandModeKey(strandId);
    const stored = await AsyncStorage.getItem(key);
    if (isStrandMode(stored)) return stored;
    await AsyncStorage.setItem(key, 'bootstrap');
    return 'bootstrap';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lightweight UUID v4. */
function generateId(): string {
  const bytes = new Uint8Array(16);
  const g = globalThis as Record<string, unknown>;
  const c = (g.crypto ?? {}) as { getRandomValues?: (buf: Uint8Array) => void };
  if (typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const cadreService = new CadreServiceImpl();
export default cadreService;
