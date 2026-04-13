description: Removed fast-text-encoding polyfill and replaced empty Node.js stubs with real shims from sereus reference app
dependencies: @noble/hashes (already in resolutions)
files: apps/mobile/index.js, apps/mobile/metro.config.js, apps/mobile/package.json, apps/mobile/shims/node-os.js (new), apps/mobile/shims/node-crypto.js (new)
----

## What was done

### Removed fast-text-encoding
- Deleted `import 'fast-text-encoding'` and its comment from `apps/mobile/index.js` (Hermes includes TextEncoder/TextDecoder natively)
- Removed `"fast-text-encoding": "^1.0.6"` from `apps/mobile/package.json` dependencies

### Created real Node.js shims
- `apps/mobile/shims/node-os.js` — provides `networkInterfaces()`, `platform()`, `type()`, `hostname()` using `react-native` Platform API (modeled on sereus reference-app-rn)
- `apps/mobile/shims/node-crypto.js` — provides `createHash(algorithm)` supporting sha256/sha512 via `@noble/hashes` (modeled on sereus reference-app-rn)

### Updated metro.config.js
- `os`/`node:os` now route to `shims/node-os.js` instead of `shims/empty.js`
- Added `crypto`/`node:crypto` routing to `shims/node-crypto.js`
- `net`, `tls` remain on `shims/empty.js` (never called at runtime)

## Testing notes

- Metro bundle succeeds (the only error is a pre-existing missing mock data file `graphs.empty.json`, unrelated)
- No new warnings or errors from our shim files
- `require('os').platform()` / `require('os').networkInterfaces()` now return real values
- `require('crypto').createHash('sha256')` now returns a functional Hash object
- Existing `crypto.getRandomValues` and `crypto.subtle.digest` polyfills in index.js are unaffected (those polyfill the Web Crypto API global, not the Node.js `crypto` module)
- TextEncoder/TextDecoder usage should remain functional (Hermes native support)
