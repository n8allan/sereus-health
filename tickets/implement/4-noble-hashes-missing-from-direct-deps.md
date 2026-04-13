description: Add @noble/hashes as a direct dependency in apps/mobile/package.json
dependencies: none
files: apps/mobile/package.json
----
## Context

`apps/mobile/index.js:87-88` imports `@noble/hashes/sha2` to polyfill `crypto.subtle.digest` for libp2p/multiformats in Hermes. The package is only listed under `resolutions` (pinned to `npm:2.0.1`) but not in `dependencies`. It resolves today via transitive pulls from libp2p, but any upstream refactor that drops that transitive path will break the Metro bundle — the same failure mode as the `event-target-polyfill` bug fixed on 2026-04-12.

## Fix

Add `"@noble/hashes": "^2.0.1"` to the `dependencies` block in `apps/mobile/package.json`. The version should align with the existing `resolutions` pin (`npm:2.0.1`). The resolution entry stays in place as a guard against transitive version drift.

After the edit, run `yarn install` from the mobile workspace and verify the package resolves correctly.

## TODO

- Add `"@noble/hashes": "^2.0.1"` to `dependencies` in `apps/mobile/package.json` (alphabetical order, after `@ungap/structured-clone`)
- Run `yarn install` from `apps/mobile` to update the lockfile
- Verify `yarn start --reset-cache` can still bundle (or at minimum that `yarn install` succeeds without errors)
