description: Add @noble/hashes as a direct dependency in apps/mobile/package.json
dependencies: none
files: apps/mobile/package.json
----
## Summary

Added `"@noble/hashes": "^2.0.1"` to the `dependencies` block in `apps/mobile/package.json` (line 21, alphabetically between `@ai-sdk/openai` and `@optimystic/db-core`). The existing `resolutions` entry (`"@noble/hashes": "npm:2.0.1"`) remains as a guard against transitive version drift.

`yarn install` completed successfully with no new warnings.

## What to verify

- `apps/mobile/package.json:21` has `@noble/hashes` in `dependencies` at `^2.0.1`
- The `resolutions` entry at line 95 is unchanged (`"@noble/hashes": "npm:2.0.1"`)
- `apps/mobile/index.js:87-88` imports `@noble/hashes/sha2` — this is the direct usage that motivates the dependency
- `yarn install` succeeds without errors (pre-existing peer-dependency warnings are unrelated)
- Metro bundler can resolve `@noble/hashes/sha2` at runtime (manual or CI check)
