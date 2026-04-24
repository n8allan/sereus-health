description: Inline UTF-8-only TextDecoder polyfill for bare RN 0.85 Hermes (needed by uint8arrays → libp2p/yamux/multiformats)
prereq: apps/mobile/index.js polyfill ordering
files: apps/mobile/index.js, tickets/complete/remove-fast-text-encoding-and-adopt-real-node-stubs.md (addendum)
----

## What was built

### Problem
After fixing the libp2p/crypto browser rewrite (ticket 4) and the react-native-mmkv v4 migration (ticket 5), first launch reached `CadreNode.start()` and failed with:

```
ReferenceError: Property 'TextDecoder' doesn't exist
[CadreService] doStart failed: Cannot read property 'Yamux' of undefined
```

Root cause: `uint8arrays/dist/src/util/bases.js` does `const decoder = new TextDecoder('utf8')` at module scope.  The surrounding module (`@chainsafe/libp2p-yamux`) is imported during `CadreNode.start()`; its module evaluation threw, so the default export resolved to `undefined`.  The "Cannot read property 'Yamux' of undefined" message is the downstream symptom.

The assumption baked into ticket `remove-fast-text-encoding-and-adopt-real-node-stubs` — that "Hermes includes TextEncoder/TextDecoder natively" — is only correct for **Expo SDK 52+** Hermes.  Bare RN 0.85.1 Hermes ships `TextEncoder` but not `TextDecoder`.

### Fix
Added a minimal UTF-8-only `TextDecoder` polyfill in `apps/mobile/index.js`, guarded by `typeof globalThis.TextDecoder === 'undefined'` so it becomes a no-op once Hermes ships a native implementation.  The polyfill supports:

- UTF-8 BOM skipping
- 1/2/3/4-byte UTF-8 sequences with surrogate-pair encoding for BMP-supplementary code points
- Invalid continuation → `U+FFFD` replacement
- `Uint8Array`, other `ArrayBufferView`, and raw `ArrayBuffer` input

Non-UTF-8 encodings throw `RangeError` at construction; none of our current consumers request a different encoding.  This keeps the polyfill to ~40 lines and avoids taking a dep on `fast-text-encoding` / `text-encoding` (which we removed in ticket 3).

Ordering: placed before `import './App'` so the entire app import tree (which pulls in libp2p via `@sereus/cadre-core`) sees the polyfill at module-load time.  The CadreService import is already lazy (`require()` inside `db/index.ts`), but the polyfill is still set up before any require runs.

### Posterity addendum
`tickets/complete/remove-fast-text-encoding-and-adopt-real-node-stubs.md` updated with a correction note pointing here.

## Testing notes

- JS-only change.  Clear Metro cache then reload: `yarn start --reset-cache`.
- Verify with the Android log sequence:
  - `[CadreService] timing: loadOrCreatePeerKey took …ms`
  - `[CadreService] Creating CadreNode…`
  - `[CadreService] Starting CadreNode…`
  - *(no `Yamux of undefined` error)*

## Related

- Ticket 4 — `libp2p/crypto` browser rewrite (fixed `new undefined()` in Ed25519 keygen).
- Ticket 5 — `react-native-mmkv` v4 API migration (`new MMKV()` → `createMMKV()`).
- These three tickets together unblock first-launch on Android for the optimystic backend.
