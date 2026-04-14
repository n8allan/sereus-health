description: Persist the libp2p Ed25519 peer identity in encrypted MMKV so the cadre node has a stable peer ID across cold starts
dependencies: none
files:
  - apps/mobile/src/services/CadreService.ts
  - apps/mobile/src/db/reset.ts
  - design/specs/domain/cadre.md
----

## What was built

`CadreServiceImpl.loadOrCreatePeerKey()` generates an Ed25519 keypair on first launch
and persists it in a dedicated encrypted MMKV instance (`sereus-peer-identity`).
On subsequent launches the stored key is loaded, giving the node a stable peer ID.
The key is passed as `privateKey` in `CadreNodeConfig`, which cadre-core forwards to
both the control and strand libp2p nodes.

The dev reset path (`resetDatabaseForDev`) clears the peer identity MMKV so a fresh
identity is generated after reset.

Documentation added to `design/specs/domain/cadre.md` under a new "Peer Identity" section.

## Key implementation details

- Storage uses MMKV `getBuffer`/`set` with `ArrayBuffer` directly (no base64 encoding,
  no `Buffer` polyfill needed in RN).
- A static encryption key (`sereus-peer-id-v1`) prevents casual reads from MMKV's
  file-backed storage. Hardware-backed key or Keychain can replace this later.
- The MMKV instance is separate from strand data stores.

## Testing / validation

- Cold start the app, note the peer ID logged by CadreService (`CadreNode started. Peer ID: ...`). Force-stop and restart — the same peer ID must appear.
- Tap the dev "Reset" button, restart — a new peer ID must appear.
- Verify strand data operations still work after restart (storage is keyed by strand ID, not peer ID).
- Verify the encrypted MMKV file is created on disk (check with adb shell or similar).
- Type check passes (`npx tsc --noEmit` in apps/mobile — only pre-existing baseUrl deprecation warning).
