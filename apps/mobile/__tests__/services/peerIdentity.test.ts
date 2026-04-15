const mockMmkvStores = new Map<string, Map<string, string | boolean | number | ArrayBuffer>>();

function mockGetOrCreateStore(id: string) {
  let store = mockMmkvStores.get(id);
  if (!store) {
    store = new Map();
    mockMmkvStores.set(id, store);
  }
  return store;
}

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn(({ id }: { id: string }) => {
    const storage = mockGetOrCreateStore(id);
    return {
      getBuffer: (key: string) => {
        const v = storage.get(key);
        return v instanceof ArrayBuffer ? v : undefined;
      },
      set: (key: string, value: string | boolean | number | ArrayBuffer) => {
        storage.set(key, value);
      },
      clearAll: () => { storage.clear(); },
    };
  }),
}));

let mockGenerateCount = 0;

function mockFakePrivateKey(marker: number) {
  return { type: 'Ed25519', _marker: marker } as unknown;
}

jest.mock('@libp2p/crypto/keys', () => ({
  generateKeyPair: jest.fn(async (_type: string) => {
    mockGenerateCount++;
    return mockFakePrivateKey(mockGenerateCount);
  }),
  privateKeyToProtobuf: jest.fn((key: { _marker: number }) =>
    new Uint8Array([key._marker, 0xED]),
  ),
  privateKeyFromProtobuf: jest.fn((bytes: Uint8Array) =>
    mockFakePrivateKey(bytes[0]!),
  ),
}));

import { loadOrCreatePeerKey, clearPeerIdentity, PEER_IDENTITY_MMKV_ID } from '../../src/services/peerIdentity';
import { generateKeyPair } from '@libp2p/crypto/keys';

beforeEach(() => {
  mockMmkvStores.clear();
  mockGenerateCount = 0;
  (generateKeyPair as jest.Mock).mockClear();
});

describe('loadOrCreatePeerKey', () => {
  test('generates a new key on first call', async () => {
    const key = await loadOrCreatePeerKey();
    expect(generateKeyPair).toHaveBeenCalledTimes(1);
    expect((key as any)._marker).toBe(1);
  });

  test('persists the key and reloads it on second call', async () => {
    const first = await loadOrCreatePeerKey();
    const second = await loadOrCreatePeerKey();

    expect(generateKeyPair).toHaveBeenCalledTimes(1);
    expect((second as any)._marker).toBe((first as any)._marker);
  });

  test('generates a new key after clearPeerIdentity', async () => {
    await loadOrCreatePeerKey();
    expect(generateKeyPair).toHaveBeenCalledTimes(1);

    clearPeerIdentity();

    const newKey = await loadOrCreatePeerKey();
    expect(generateKeyPair).toHaveBeenCalledTimes(2);
    expect((newKey as any)._marker).toBe(2);
  });

  test('stores data in the expected MMKV instance', async () => {
    await loadOrCreatePeerKey();
    const store = mockMmkvStores.get(PEER_IDENTITY_MMKV_ID);
    expect(store).toBeDefined();
    expect(store!.size).toBe(1);
  });
});

describe('clearPeerIdentity', () => {
  test('empties the peer identity MMKV store', async () => {
    await loadOrCreatePeerKey();
    expect(mockMmkvStores.get(PEER_IDENTITY_MMKV_ID)!.size).toBe(1);

    clearPeerIdentity();
    expect(mockMmkvStores.get(PEER_IDENTITY_MMKV_ID)!.size).toBe(0);
  });
});
