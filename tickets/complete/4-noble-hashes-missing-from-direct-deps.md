description: Added @noble/hashes as a direct dependency in apps/mobile/package.json
files: apps/mobile/package.json, apps/mobile/shims/node-crypto.js, apps/mobile/index.js
----
## What was done

Added `"@noble/hashes": "^2.0.1"` to `dependencies` in `apps/mobile/package.json` (line 21). The package is directly imported in `index.js` (crypto.subtle.digest polyfill) and `shims/node-crypto.js` (Node.js crypto.createHash shim), so it must be a direct dependency rather than relying on transitive resolution alone. The existing `resolutions` entry (`"@noble/hashes": "npm:2.0.1"`) was left in place as a guard against transitive version drift.

## Testing

- `__tests__/shims/node-crypto.test.js` — 9 tests covering sha256/sha512 correctness, case-insensitive algorithm names, dashed form (`sha-256`), chainable `update()`, Uint8Array input, and unsupported-algorithm error. All pass.
- `yarn install` completes without new warnings.
- Runtime validation: Metro bundler resolves `@noble/hashes/sha2` via the direct dependency entry.

## Key files

- `apps/mobile/package.json:21` — dependency entry
- `apps/mobile/package.json:96` — resolution entry (unchanged)
- `apps/mobile/index.js:87-88` — crypto.subtle.digest polyfill using sha256/sha512
- `apps/mobile/shims/node-crypto.js` — Node.js createHash shim wrapping @noble/hashes
- `apps/mobile/__tests__/shims/node-crypto.test.js` — test suite
