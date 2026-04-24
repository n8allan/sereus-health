description: Removed fast-text-encoding polyfill and replaced empty Node.js stubs with real shims
prereq: @noble/hashes (in resolutions)
files: apps/mobile/index.js, apps/mobile/metro.config.js, apps/mobile/package.json, apps/mobile/shims/node-os.js, apps/mobile/shims/node-crypto.js, apps/mobile/jest.config.js, apps/mobile/__tests__/shims/node-os.test.js, apps/mobile/__tests__/shims/node-crypto.test.js
----

## What was built

### Removed fast-text-encoding
- Deleted `import 'fast-text-encoding'` from `index.js` and removed from `package.json` (Hermes includes TextEncoder natively on RN 0.85)

> **Correction (see ticket `textdecoder-polyfill-for-bare-rn-hermes`):**
> Bare RN 0.85 Hermes ships `TextEncoder` but NOT `TextDecoder`.  Expo SDK 52+
> Hermes has both.  `apps/mobile/index.js` now provides an inline UTF-8-only
> `TextDecoder` polyfill — required by `uint8arrays` (used by libp2p/yamux/
> multiformats at module-scope).  The `fast-text-encoding` removal still
> stands; the inline polyfill replaces it with a smaller, targeted shim.

### Real Node.js shims
- `shims/node-os.js` — `networkInterfaces()`, `platform()`, `type()`, `hostname()` via react-native Platform API
- `shims/node-crypto.js` — `createHash(algorithm)` supporting sha256/sha512 via `@noble/hashes`, with chainable `update()` and `digest()` returning `Uint8Array`
- Metro routes `os`/`node:os` and `crypto`/`node:crypto` to real shims; `net`/`tls` remain as empty stubs

## Review notes
- Comment in metro.config.js updated to reflect that os/crypto are now real shims (no longer "never called at runtime")
- Jest preset updated: `react-native` → `@react-native/jest-preset` (required by react-native 0.85)
- `@noble/hashes` requires `moduleNameMapper` and `transformIgnorePatterns` in jest.config.js (ESM package with exports map)
- `digest()` does not support encoding parameter (e.g. `'hex'`) — adequate for known callers (`@chainsafe/libp2p-noise` calls `digest()` without encoding)

## Testing
- 16 unit tests across `__tests__/shims/node-os.test.js` and `__tests__/shims/node-crypto.test.js`
- Tests cover: all exported functions, algorithm case-insensitivity, sha-256/sha-512 dashed forms, chainable update, multi-update equivalence, Uint8Array input, unsupported algorithm error, default export structure
- Metro bundle resolves all shim files successfully (only pre-existing `graphs.empty.json` error remains)
