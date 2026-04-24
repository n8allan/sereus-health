description: Migrate from react-native-mmkv v3 `new MMKV()` class API to v4 `createMMKV()` factory
prereq: react-native-mmkv@^4.3.1 (nitro-modules backed)
files: apps/mobile/src/services/peerIdentity.ts, apps/mobile/src/services/CadreService.ts, apps/mobile/src/db/reset.ts
----

## What was built

### Problem
First launch failed in `openPeerStore()` with `TypeError: undefined cannot be used as a constructor` at the `new MMKV({...})` call.  react-native-mmkv v4 (upgraded to Nitro Modules) no longer exports `MMKV` as a runtime value — it is a type-only export — so `new MMKV({...})` is effectively `new undefined()`.  TypeScript did not flag the call because `import { MMKV } from 'react-native-mmkv'` imports the symbol for both the type and (apparently) value position; the failure only surfaces at runtime.

### Fix
Replace the v3 API usages:

```
- import { MMKV } from 'react-native-mmkv';
+ import { createMMKV, type MMKV } from 'react-native-mmkv';

- const mmkv = new MMKV({ id, encryptionKey });
+ const mmkv = createMMKV({ id, encryptionKey });
```

Applied in:
- `apps/mobile/src/services/peerIdentity.ts` — `openPeerStore()`
- `apps/mobile/src/services/CadreService.ts` — `storage.provider` callback that builds `MMKVRawStorage`
- `apps/mobile/src/db/reset.ts` — dev reset path that clears the strand MMKV instance

The sereus reference-app-rn still pins `react-native-mmkv@^3.2.0` and uses the v3 `new MMKV(...)` API correctly — no change needed there.

## Testing notes

- Metro cache reset not required (JS-only change, no module-graph shift).
- Native rebuild not required — v4 has been in the app's native build since it was added; this is purely a JS API migration.
- On Android first launch, peerIdentity's `openPeerStore()` now returns an MMKV instance and Ed25519 key generation proceeds.

## Related

- `tickets/complete/libp2p-crypto-browser-variant-rewrite.md` — stacks with this fix.  That rewrite is needed once `generateKeyPair('Ed25519')` actually runs (the step after `openPeerStore`).
- react-native-mmkv v4 migration notes: `MMKV` class → `createMMKV` factory; same object shape returned, so call sites below construction are unchanged.
