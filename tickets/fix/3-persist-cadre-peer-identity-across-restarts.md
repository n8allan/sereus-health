description: Persist the libp2p Ed25519 peer identity so the cadre node has a stable identity across cold starts
dependencies: requires a privateKey injection point in `@optimystic/db-p2p` `createLibp2pNodeBase`
files:
  - apps/mobile/src/services/CadreService.ts
  - C:/projects/optimystic/packages/db-p2p/src/libp2p-node-base.ts
  - C:/projects/optimystic/packages/db-p2p/src/libp2p-node-rn.ts
  - C:/projects/sereus/packages/cadre-core/src/cadre-node.ts (already has a `privateKey` config field but ignores it — see TODO at line 277)
  - C:/projects/sereus/packages/cadre-core/src/strand-instance-manager.ts (also creates a libp2p node per strand)
----
## Context

`apps/mobile/src/services/CadreService.ts` persists the **party ID** and **strand ID** in `AsyncStorage`, and strand data is persisted in MMKV via `MMKVRawStorage`. However, the **libp2p peer identity (Ed25519 keypair)** is regenerated on every cold start.

In `optimystic/packages/db-p2p/src/libp2p-node-base.ts:160`:

```ts
const nodePrivateKey = await generateKeyPair('Ed25519');
```

There is no path through `NodeOptions` to inject a stored private key. `CadreNodeConfig` has a `privateKey` field, but `cadre-node.ts:279` explicitly notes:

```
// Note: createLibp2pNode doesn't support privateKey directly yet
// For now we create the node without it
```

Consequences observed by the user:
- The device shows up with a brand-new peer ID after each restart.
- `CadrePeer` self-registration (`cadre-node.ts:321 registerSelf`) is currently a no-op anyway, but when it lands the table will accumulate dead peer entries.
- From the user's perspective, "the cadre is recreated every time" — the persistent strand data is invisible because the device's identity is not stable, and the SereusConnections screen has no stable record of "this device".
- Future enrollment / authority signing flows will be broken because they rely on a stable peer identity.

The party ID and strand IDs **are** stable, so the control network and strand network names are stable; only this device's identity within those networks is volatile.

## Architecture

Two libp2p nodes are created per cadre boot:

1. **Control node** — created in `cadre-node.ts createControlNode()` for the `control-${partyId}` network.
2. **Strand node(s)** — one per strand, created in `strand-instance-manager.ts startStrand()` for `strand-${strandId}`.

The user's identity should be **the same Ed25519 keypair across both** (a single device = a single peer). The current architecture would otherwise generate two unrelated peer IDs per cold start, which is also wrong.

Decision needed: do the control node and strand nodes share one peer identity, or do strands have their own identities scoped to the strand? Per `design/specs/domain/cadre.md`, a "Cadre" is a user's cluster of devices, and a "Strand" is a shared data space on top of that. The natural model is **one peer identity per device**, used for both the control network and any strands the device participates in. Confirm against `sereus/docs/cadre-architecture.md` before implementing.

## Storage location

The Ed25519 private key is sensitive. Two options:

- **Keychain / Keystore** via a native module (`react-native-keychain` or similar) — preferred long-term, biometrically protectable. Adds a dependency.
- **MMKV** with `encryptionKey` — already in the dependency tree, simpler. Lower bar than Keychain but acceptable as a first step if we document the tradeoff.

`design/specs/domain/cadre.md` already mentions "Local vault: Keychain/Keystore; biometric or login protection" as the target for *authority keys*. The peer identity is a separate, lower-stakes key, so MMKV-with-encryption is a reasonable starting point and is what most p2p RN apps do. Pick one and document the choice in `design/specs/domain/cadre.md`.

## Implementation sketch

1. **db-p2p**: extend `NodeOptions` with `privateKey?: PrivateKey` and use it in `createLibp2pNodeBase` instead of always calling `generateKeyPair('Ed25519')`. Default behavior (no key passed) stays the same.
2. **cadre-core**: thread `config.privateKey` through `CadreNode.createControlNode()` → `createLibp2pNode()`; same change in `StrandInstanceManager.startStrand()` so the strand libp2p node uses the same key. Alternatively, pass the key via a callback so cadre-core stays storage-agnostic.
3. **CadreService**: on first start, generate the Ed25519 keypair (using `@libp2p/crypto/keys generateKeyPair`), serialize it (e.g. `privateKeyToProtobuf` / base64), store in MMKV (encrypted) or Keychain. On subsequent starts, load and pass to `CadreNode`.
4. **Reset path**: `closeDatabase()` / dev "Reset" should clear the stored key alongside the strand data so a reset gives a clean slate.

## Tests / validation

- Cold start the app, capture the peer ID printed in `CadreService` logs. Force-stop and restart; the same peer ID should appear.
- Once `registerSelf` is implemented, verify `CadrePeer` only contains one row for the device across many restarts.
- Verify that strand data written before restart is still readable (the storage is keyed by strand ID, not peer ID, so this should already work — confirm it does).
- Verify the dev "Reset" button clears the stored key and a fresh peer ID is generated next start.

## TODO

- Confirm shared-key-vs-per-strand-key decision against `sereus/docs/cadre-architecture.md` (block on this if unclear)
- Pick storage backend (MMKV-encrypted vs. Keychain) and document in `design/specs/domain/cadre.md`
- Add `privateKey` to `NodeOptions` in `optimystic/packages/db-p2p/src/libp2p-node-base.ts`
- Use the injected key (skip `generateKeyPair` when provided) in `createLibp2pNodeBase`
- Re-export from `libp2p-node-rn.ts` so RN consumers can pass it
- Thread the key through `cadre-core` `CadreNode.createControlNode` and `StrandInstanceManager.startStrand`
- In `apps/mobile/src/services/CadreService.ts`, add `loadOrCreateNodeKey()` that returns a libp2p `PrivateKey`, persists on first creation, and pass into `CadreNodeConfig.privateKey`
- Update the dev reset path in `apps/mobile/src/db/index.ts closeDatabase()` (or wherever reset lives) to also clear the stored key
- Smoke test: cold start twice, confirm peer ID is identical
