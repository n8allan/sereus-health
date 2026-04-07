description: Remove unnecessary fast-text-encoding polyfill and replace empty Node.js stubs with real shims from sereus
dependencies: sereus/packages/reference-app-rn/polyfills/node-os.js, sereus/packages/reference-app-rn/polyfills/node-crypto.js
files: apps/mobile/index.js, apps/mobile/metro.config.js, apps/mobile/package.json, apps/mobile/shims/empty.js, apps/mobile/shims/node-os.js (new), apps/mobile/shims/node-crypto.js (new)
----
## Remove fast-text-encoding

Hermes includes TextEncoder/TextDecoder natively. The sereus reference app documents this as unnecessary (see README.md "Built-in" table), and sereus-health's inclusion of `fast-text-encoding` was a redundant addition. Remove it.

In `apps/mobile/index.js`:
- Delete the `import 'fast-text-encoding';` line (currently line 105) and its comment block

In `apps/mobile/package.json`:
- Remove `"fast-text-encoding": "^1.0.6"` from dependencies

## Replace empty.js stubs for os and crypto with real shims

The sereus reference app provides real implementations at `polyfills/node-os.js` and `polyfills/node-crypto.js`. Sereus-health currently stubs all of `os`, `net`, `tls` to the same `empty.js`. The `os` and `crypto` stubs should use real shims since libp2p code paths do call `os.networkInterfaces()`, `os.platform()`, etc. and `crypto.createHash()`.

### node-os.js

Create `apps/mobile/shims/node-os.js` based on sereus's `packages/reference-app-rn/polyfills/node-os.js`. Provides:
- `networkInterfaces()` — returns `{}` (libp2p falls back to other discovery)
- `platform()` — returns `Platform.OS`
- `type()` — returns `'Darwin'` or `'Linux'` based on platform
- `hostname()` — returns `'localhost'`

### node-crypto.js

Create `apps/mobile/shims/node-crypto.js` based on sereus's `packages/reference-app-rn/polyfills/node-crypto.js`. Provides:
- `createHash(algorithm)` — supports sha256/sha512 via `@noble/hashes` (already a dependency via resolutions)

### metro.config.js changes

Update the `nodeBuiltinStubs` in `apps/mobile/metro.config.js` to:
- Point `os` and `node:os` to `shims/node-os.js` instead of `shims/empty.js`
- Point `crypto` and `node:crypto` to `shims/node-crypto.js` instead of `shims/empty.js` (note: `crypto` is not currently stubbed — only the global `crypto` object is polyfilled in index.js. But adding the metro stub ensures any `require('crypto')` or `import 'node:crypto'` resolves to the shim rather than failing)
- Keep `net`, `node:net`, `tls`, `node:tls` pointing to `empty.js` (sereus doesn't provide alternatives for these either; they're truly never called at runtime)

## Testing notes

- Build should succeed (metro bundle)
- TextEncoder/TextDecoder usage should still work (Hermes native)
- Any code doing `require('os').platform()` or `require('crypto').createHash('sha256')` should return real values instead of `{}`
- Existing polyfills for `crypto.getRandomValues` and `crypto.subtle.digest` in index.js are unrelated to the Node.js `crypto` module stub and should be unaffected

## TODO

- Remove `import 'fast-text-encoding'` and its comment from `apps/mobile/index.js`
- Remove `fast-text-encoding` from `apps/mobile/package.json` dependencies
- Create `apps/mobile/shims/node-os.js` modeled on sereus's `packages/reference-app-rn/polyfills/node-os.js`
- Create `apps/mobile/shims/node-crypto.js` modeled on sereus's `packages/reference-app-rn/polyfills/node-crypto.js`
- Update `apps/mobile/metro.config.js` to route `os`/`node:os` to `shims/node-os.js` and add `crypto`/`node:crypto` routing to `shims/node-crypto.js`
- Run metro bundler to verify the build succeeds
