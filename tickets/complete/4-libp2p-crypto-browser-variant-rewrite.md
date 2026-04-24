description: Metro rewrites @libp2p/crypto Node files to their .browser.js variants so Ed25519 key generation works on RN first launch
prereq: @libp2p/crypto@5.x (ships parallel .browser.js variants), @noble/curves (used by the browser variants)
files: apps/mobile/metro.config.js, sereus/packages/reference-app-rn/metro.config.js, sereus/packages/reference-app-rn/README.md, sereus/docs/reference-app-rn.md
----

## What was built

### Problem
First-launch in `apps/mobile` crashed during `CadreService.doStart()` with `undefined cannot be used as a constructor`, surfacing through `[DB Init]` and `[LogHistory]` as a follow-on failure.  Root cause: `loadOrCreatePeerKey()` calls `generateKeyPair('Ed25519')` from `@libp2p/crypto/keys`, which Metro resolved to `@libp2p/crypto/dist/src/keys/ed25519/index.js` — the Node variant that does `import crypto from 'crypto'` and calls `crypto.generateKeyPairSync`, `createPrivateKey`, `sign`, `verify`.  Our `apps/mobile/shims/node-crypto.js` only implements `createHash(sha256|sha512)` (established by ticket `remove-fast-text-encoding-and-adopt-real-node-stubs`), so `generateKeyPairSync` resolved to `undefined` and the subsequent call inside `generateKey()` produced the "undefined cannot be used as a constructor" error.

### Why the browser map wasn't already applied
`@libp2p/crypto` ships parallel `.browser.js` variants and declares them in its package.json `browser` field:

```
"browser": {
  "./dist/src/ciphers/aes-gcm.js":       "./dist/src/ciphers/aes-gcm.browser.js",
  "./dist/src/hmac/index.js":            "./dist/src/hmac/index.browser.js",
  "./dist/src/keys/ecdh/index.js":       "./dist/src/keys/ecdh/index.browser.js",
  "./dist/src/keys/ed25519/index.js":    "./dist/src/keys/ed25519/index.browser.js",
  "./dist/src/keys/rsa/index.js":        "./dist/src/keys/rsa/index.browser.js",
  "./dist/src/keys/secp256k1/index.js":  "./dist/src/keys/secp256k1/index.browser.js",
  "./dist/src/webcrypto/webcrypto.js":   "./dist/src/webcrypto/webcrypto.browser.js"
}
```

The browser variants use `@noble/curves` + WebCrypto and work in Hermes.  With `unstable_enablePackageExports: true` (the RN 0.85 / Expo SDK 52+ default) Metro resolves via the `exports` map and the `browser` file-rewrite is not reliably applied on top — the Node variant wins.

### Fix
Add a `resolver.resolveRequest` hook that reads the package's own `browser` map at config-load time (by locating `node_modules/@libp2p/crypto/package.json` through the configured `nodeModulesPaths`) and rewrites resolved file paths using that map.  Reading the map dynamically means future upstream additions are picked up with no config change.

The same hook is applied in:
- `apps/mobile/metro.config.js` (this repo)
- `sereus/packages/reference-app-rn/metro.config.js` (reference app — also potentially affected; applied preemptively for parity)

### Docs
- `sereus/packages/reference-app-rn/README.md` — added a "libp2p/crypto Node → browser rewrite" section under Hermes Polyfills.
- `sereus/docs/reference-app-rn.md` — added explanation block under the metro.config.js sample.
- `apps/mobile/shims/node-crypto.js` (sereus-health) — no change required; the shim stays minimal (`createHash` only) because key generation / sign / verify go through the `.browser.js` variants.

## Testing notes

- Android first launch — the three cascading errors (`[CadreService] doStart failed`, `[DB Init] DB init failed`, `[LogHistory] Failed to load history`) no longer appear.  Party ID, peer key, and strand init complete; `LogHistory` screen renders.
- Metro cache must be cleared the first time this lands (`yarn start --reset-cache` or delete `%TEMP%\metro-*`) because the change is in `metro.config.js`.
- No native rebuild is required — this is a JS-bundle-only change.
- The `browser` map is loaded at Metro startup; no perf hit per-resolution beyond a single object lookup.

## Future / related

- If a future `@libp2p/crypto` release adds more Node-only modules with `.browser.js` counterparts, they will be picked up automatically via the `browser` field.
- If the package drops the `browser` field in favor of an `exports` condition (e.g. `"browser"` or `"react-native"`), the hook becomes dead code — remove it and let `unstable_conditionsByPlatform` handle it.
- See also `tickets/complete/remove-fast-text-encoding-and-adopt-real-node-stubs.md` for the earlier Node stub/shim work that left `node-crypto.js` deliberately minimal.
