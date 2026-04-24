description: Persist the libp2p Ed25519 peer identity in encrypted MMKV so the cadre node has a stable peer ID across cold starts
files:
  - apps/mobile/src/services/peerIdentity.ts
  - apps/mobile/src/services/CadreService.ts
  - apps/mobile/src/db/reset.ts
  - apps/mobile/__tests__/services/peerIdentity.test.ts
  - apps/mobile/jest.config.js
  - design/specs/domain/cadre.md
----

## What was built

A stable Ed25519 peer identity for the cadre node, persisted in an encrypted MMKV
instance (`sereus-peer-identity`). On first launch, `loadOrCreatePeerKey()` generates
an Ed25519 keypair and stores the protobuf-serialized private key. On subsequent
launches the stored key is loaded, giving the node a stable peer ID across cold starts.

The key is passed as `privateKey` in `CadreNodeConfig`, which cadre-core forwards to
both the control and strand libp2p nodes.

## Key files

- **`peerIdentity.ts`** — extracted module with `loadOrCreatePeerKey()`, `clearPeerIdentity()`,
  and shared MMKV constants. Eliminates prior duplication between CadreService and reset.
- **`CadreService.ts`** — imports `loadOrCreatePeerKey` from the shared module.
- **`reset.ts`** — imports `clearPeerIdentity` from the shared module for dev reset.
- **`cadre.md`** — "Peer Identity" section documents the storage approach.

## Review notes

- **DRY**: During review, extracted peer identity logic into `peerIdentity.ts` to
  eliminate duplicated MMKV constants and config between CadreService.ts and reset.ts.
- **Security**: Static encryption key (`sereus-peer-id-v1`) prevents casual reads.
  Hardware-backed key or Keychain migration deferred (documented in cadre.md).
- **Storage**: Uses MMKV `getBuffer`/`set` with `ArrayBuffer` directly — no base64
  or Buffer polyfill needed. The `.slice().buffer` pattern ensures a clean ArrayBuffer
  from the protobuf Uint8Array.
- **Jest config**: Added `@libp2p/crypto` subpath export mapper for test resolution.

## Testing

5 unit tests in `__tests__/services/peerIdentity.test.ts`:
- Generates a new key on first call
- Persists the key and reloads it on second call (no new generation)
- Generates a new key after `clearPeerIdentity()`
- Stores data in the expected MMKV instance
- `clearPeerIdentity` empties the store

Manual validation:
- Cold start the app, note peer ID in logs. Force-stop and restart — same peer ID.
- Dev "Reset" button, restart — new peer ID appears.
- Strand data operations unaffected (storage keyed by strand ID, not peer ID).

Type check passes (`npx tsc --noEmit` — only pre-existing baseUrl deprecation warning).
All 21 tests pass.
