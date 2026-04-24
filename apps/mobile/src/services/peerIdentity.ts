import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import type { PrivateKey } from '@libp2p/interface';
import { createMMKV, type MMKV } from 'react-native-mmkv';

export const PEER_IDENTITY_MMKV_ID = 'sereus-peer-identity';
export const PEER_IDENTITY_MMKV_KEY = 'peerPrivateKey';
export const PEER_IDENTITY_ENCRYPTION_KEY = 'sereus-peer-id-v1';

function openPeerStore(): MMKV {
  return createMMKV({
    id: PEER_IDENTITY_MMKV_ID,
    encryptionKey: PEER_IDENTITY_ENCRYPTION_KEY,
  });
}

export async function loadOrCreatePeerKey(): Promise<PrivateKey> {
  const mmkv = openPeerStore();
  const stored = mmkv.getBuffer(PEER_IDENTITY_MMKV_KEY);
  if (stored) {
    return privateKeyFromProtobuf(new Uint8Array(stored));
  }
  const key = await generateKeyPair('Ed25519');
  const bytes = privateKeyToProtobuf(key);
  mmkv.set(PEER_IDENTITY_MMKV_KEY, bytes.slice().buffer);
  return key;
}

export function clearPeerIdentity(): void {
  openPeerStore().clearAll();
}
