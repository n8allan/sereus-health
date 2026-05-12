import type { PrivateKey } from '@libp2p/interface';
import {
  loadOrCreateRNPeerKey,
  openOptimysticRNDb,
} from '@optimystic/db-p2p-storage-rn';
import { LevelDB, LevelDBWriteBatch } from 'rn-leveldb';

export const PEER_IDENTITY_DB_NAME = 'sereus-peer-identity';

function openIdentityDb() {
  return openOptimysticRNDb({
    openFn: (name, createIfMissing, errorIfExists) =>
      new LevelDB(name, createIfMissing, errorIfExists),
    WriteBatch: LevelDBWriteBatch,
    name: PEER_IDENTITY_DB_NAME,
  });
}

export async function loadOrCreatePeerKey(): Promise<PrivateKey> {
  const db = openIdentityDb();
  try {
    return await loadOrCreateRNPeerKey(db);
  } finally {
    await db.close();
  }
}

export function clearPeerIdentity(): void {
  LevelDB.destroyDB(PEER_IDENTITY_DB_NAME, true);
}
