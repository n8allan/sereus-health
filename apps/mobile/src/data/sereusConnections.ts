import { USE_QUEREUS } from '../db/config';
import { getVariant } from '../mock';
import { cadreService } from '../services/CadreService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthorityKey = {
  id: string;
  type: 'vault' | 'dongle' | 'external';
  protection: 'login' | 'biometric' | 'password';
  publicKey: string;
};

export type SereusNode = {
  id: string;
  name: string;
  type: 'cadre' | 'guest';
  deviceType: 'phone' | 'server' | 'desktop' | 'other';
  status: 'online' | 'unknown' | 'unreachable';
  peerId: string;
  addedAt: string;
  source?: string;
};

export type SereusConnectionsData = {
  partyId: string | null;
  keys: AuthorityKey[];
  cadreNodes: SereusNode[];
  guestNodes: SereusNode[];
};

// ---------------------------------------------------------------------------
// Mock data (scenario tooling)
// ---------------------------------------------------------------------------

function loadMock(variant: string): SereusConnectionsData {
  switch (variant) {
    case 'empty':
      return require('../../mock/data/sereus-connections.empty.json') as SereusConnectionsData;
    case 'happy':
    default:
      return require('../../mock/data/sereus-connections.happy.json') as SereusConnectionsData;
  }
}

// ---------------------------------------------------------------------------
// Cadre data (real)
// ---------------------------------------------------------------------------

/**
 * Ensure the CadreNode is started.  Idempotent; swallows errors so the UI
 * can fall back to empty state rather than crashing.
 */
async function ensureCadreStarted(): Promise<void> {
  await cadreService.ensureStarted();
}

/**
 * Load connections data from the cadre control database.
 *
 * Phase 1: control database starts empty — no AuthorityKey or CadrePeer rows
 * exist until the user creates a key (phase 2) or enrolls a node (phase 3).
 *
 * The raw Quereus Database is accessed via:
 *   controlDatabase.getDatabase().exec(sql)
 */
async function loadCadreData(): Promise<SereusConnectionsData> {
  const controlDb = cadreService.controlDatabase;
  if (!controlDb) {
    return {
      partyId: cadreService.partyId,
      keys: [],
      cadreNodes: [],
      guestNodes: [],
    };
  }

  const db = controlDb.getDatabase();

  // Quereus uses db.eval() for SELECT (returns AsyncIterable of rows).

  // ---- Authority keys ---------------------------------------------------
  const keys: AuthorityKey[] = [];
  try {
    for await (const row of db.eval('SELECT Key FROM CadreControl.AuthorityKey')) {
      keys.push({
        id: String(row.Key),
        // Phase 2+: store type/protection in a local metadata table.
        // For now, default to vault/biometric since that's the only implemented
        // key creation path.
        type: 'vault',
        protection: 'biometric',
        publicKey: String(row.Key),
      });
    }
  } catch {
    // Table may not exist yet if control schema init is async
  }

  // ---- Cadre peers (nodes) -----------------------------------------------
  const cadreNodes: SereusNode[] = [];
  try {
    for await (const row of db.eval('SELECT PeerId, Multiaddr FROM CadreControl.CadrePeer')) {
      const peerId = String(row.PeerId);
      cadreNodes.push({
        id: peerId,
        // Phase 3+: store display name, device type, added-at in local metadata.
        name: peerId === cadreService.peerId ? 'This device' : formatPeerId(peerId),
        type: 'cadre',
        deviceType: 'phone',
        status: 'unknown',
        peerId,
        addedAt: new Date().toISOString(),
      });
    }
  } catch {
    // Table may not exist yet
  }

  // ---- Strand guests -----------------------------------------------------
  // Phase 4+: query Strand table + local metadata for guest membership.
  const guestNodes: SereusNode[] = [];

  return {
    partyId: cadreService.partyId,
    keys,
    cadreNodes,
    guestNodes,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getSereusConnections(): Promise<SereusConnectionsData> {
  if (!USE_QUEREUS) {
    const variant = getVariant();
    if (variant === 'error') {
      throw new Error('mock:error');
    }
    const raw = loadMock(variant);
    return {
      partyId: raw.partyId ?? null,
      keys: raw.keys ?? [],
      cadreNodes: raw.cadreNodes ?? [],
      guestNodes: raw.guestNodes ?? [],
    };
  }

  // Real mode — start cadre and query control database
  try {
    await ensureCadreStarted();
  } catch (err) {
    console.warn('[sereus] CadreService failed to start:', err);
    // Return empty state so the UI renders rather than crashing.
    return {
      partyId: cadreService.partyId,
      keys: [],
      cadreNodes: [],
      guestNodes: [],
    };
  }

  return loadCadreData();
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function formatPeerId(peerId: string): string {
  const s = peerId ?? '';
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export function formatPartyId(partyId: string | null): string {
  if (!partyId) return '—';
  if (partyId.length <= 12) return partyId;
  return `${partyId.slice(0, 8)}…`;
}
