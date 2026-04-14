description: Persist the libp2p Ed25519 peer identity in encrypted MMKV so the cadre node has a stable peer ID across cold starts
dependencies: none — db-p2p and cadre-core already accept `privateKey` via config
files:
  - apps/mobile/src/services/CadreService.ts (main changes)
  - apps/mobile/src/db/reset.ts (clear stored key on dev reset)
  - design/specs/domain/cadre.md (document storage choice)
----

## Context

The libp2p peer identity (Ed25519 keypair) is regenerated on every cold start because `CadreService` never passes `privateKey` in `CadreNodeConfig`. The party ID and strand ID are already persisted in AsyncStorage, but the peer identity is not.

The full plumbing already exists upstream:

- **db-p2p** `NodeOptions.privateKey?: PrivateKey` — `createLibp2pNodeBase` does `options.privateKey ?? await generateKeyPair('Ed25519')` (libp2p-node-base.ts:170). No changes needed.
- **cadre-core** `CadreNodeConfig.privateKey?: PrivateKey` — threaded through `createControlNode()` (cadre-node.ts:282), and forwarded to strand nodes via `StrandInstanceManager.startStrand()` (cadre-node.ts:375, 507 → strand-instance-manager.ts:206). No changes needed.

Only the mobile app layer needs changes: generate once, persist, and pass at startup.

## Architecture decisions (confirmed)

**One peer identity per device** — shared across the control node and all strand nodes. Confirmed by `sereus/docs/cadre-architecture.md`. `CadreNodeConfig.privateKey` is already forwarded to both control and strand libp2p nodes by cadre-core.

**Storage: MMKV with encryption** — `react-native-mmkv` is already a dependency and supports `encryptionKey`. This is a lower-stakes key than authority keys (which will use Keychain/Keystore later). Acceptable first step per the existing note in `design/specs/domain/cadre.md` line 41. No new native dependencies needed.

## Implementation

### Phase 1: CadreService — `loadOrCreatePeerKey()`

In `apps/mobile/src/services/CadreService.ts`:

1. Add imports:
   ```ts
   import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
   ```
   `@libp2p/crypto` is already in the dependency tree (transitive via libp2p). The app already imports directly from transitive deps like `@libp2p/websockets`.

2. Add constants for the MMKV instance:
   ```ts
   const PEER_KEY_MMKV_ID = 'sereus-peer-identity';
   const PEER_KEY_MMKV_KEY = 'peerPrivateKey';
   const PEER_KEY_ENCRYPTION_KEY = 'sereus-peer-id-v1';
   ```
   Use a dedicated MMKV instance (separate from strand data) with a static encryption key. The encryption key prevents casual reads of the key from MMKV's file-backed storage. A hardware-backed key or Keychain can replace this later.

3. Add `loadOrCreatePeerKey()` private method:
   ```ts
   private async loadOrCreatePeerKey(): Promise<PrivateKey> {
     const mmkv = new MMKV({
       id: PEER_KEY_MMKV_ID,
       encryptionKey: PEER_KEY_ENCRYPTION_KEY,
     });
     const stored = mmkv.getString(PEER_KEY_MMKV_KEY);
     if (stored) {
       const bytes = Buffer.from(stored, 'base64');
       return privateKeyFromProtobuf(bytes);
     }
     const key = await generateKeyPair('Ed25519');
     const bytes = privateKeyToProtobuf(key);
     mmkv.set(PEER_KEY_MMKV_KEY, Buffer.from(bytes).toString('base64'));
     return key;
   }
   ```

4. In `doStart()`, call `loadOrCreatePeerKey()` before creating the config, and include `privateKey` in the `CadreNodeConfig`:
   ```ts
   const privateKey = await this.loadOrCreatePeerKey();
   // ...
   const config: CadreNodeConfig = {
     privateKey,
     controlNetwork: { ... },
     // ...rest unchanged
   };
   ```

5. Add `import type { PrivateKey } from '@libp2p/interface';` (already a direct dep in package.json).

### Phase 2: Reset path

In `apps/mobile/src/db/reset.ts`, inside the `USE_OPTIMYSTIC` block, after clearing AsyncStorage and strand MMKV, also clear the peer identity MMKV:

```ts
try {
  const { MMKV } = require('react-native-mmkv');
  const peerMmkv = new MMKV({
    id: 'sereus-peer-identity',
    encryptionKey: 'sereus-peer-id-v1',
  });
  peerMmkv.clearAll();
  logger.info('Cleared peer identity store');
} catch (e) {
  logger.debug('Peer identity clear failed:', e);
}
```

### Phase 3: Documentation

In `design/specs/domain/cadre.md`, add a "Peer Identity" section after "Authority Keys" (after line 45):

```markdown
## Peer Identity

Each device has a stable Ed25519 peer identity used for all libp2p networks
(control and strands). The private key is stored in an encrypted MMKV instance
(`sereus-peer-identity`). This is a lower-stakes key than authority keys —
migration to Keychain/Keystore is deferred until biometric protection is needed.
The dev reset flow clears the stored key so a fresh identity is generated.
```

## Tests / validation

- Cold start the app, note the peer ID logged by CadreService. Force-stop and restart — the same peer ID must appear.
- Tap the dev "Reset" button, restart — a new peer ID must appear.
- Verify strand data operations still work after restart (storage is keyed by strand ID, not peer ID).
- Verify the encrypted MMKV file is created on disk (check with adb shell or similar).

## TODO

- Add `loadOrCreatePeerKey()` to `CadreServiceImpl` in `apps/mobile/src/services/CadreService.ts`
- Pass `privateKey` in `CadreNodeConfig` in `doStart()`
- Clear the peer identity MMKV in `apps/mobile/src/db/reset.ts` `resetDatabaseForDev()`
- Add "Peer Identity" section to `design/specs/domain/cadre.md`
- Build and type-check (`yarn tsc` in apps/mobile)
