description: Speculative cold-start interventions to revisit after the lazy-strand and parallel-startup tickets land. Each is gated on a measurement showing it actually matters.
prereq: cadre-lazy-strand-bring-up, cadre-parallel-control-strand-startup
files:
  - apps/mobile/src/services/CadreService.ts
  - C:/projects/sereus/packages/cadre-core/src/strand-database.ts
  - C:/projects/sereus/packages/cadre-core/src/control-database.ts
----

## Context

The parent plan ticket (`5-cadre-cold-start-performance`, archived) listed several speculative interventions ordered roughly by ROI per effort. The first two — lazy strand bring-up and parallelizing control + strand — are addressed by their own implement tickets. The remaining items are speculative without measurements, and several were noticed to already be in place during the plan-stage research:

- **Already done — verify only.** The mobile config passes `profile: 'transaction'`, and both `cadre-node.ts:281` (control libp2p) and `strand-instance-manager.ts:210` (strand libp2p) already gate `arachnode.enableRingZulu` on `profile === 'storage'`. The `setInterval` Arachnode monitor never starts on the phone today.
- **Already done — verify only.** `StrandWatcher.start()` already defers its first poll by 100ms via `setTimeout` (`strand-watcher.ts:160`). The 5s polling cadence is unchanged.
- **Already done — confirm.** `extractInnerDDL` is at module-top in `CadreService.ts`, not inside `doStart`.

The tail interventions worth keeping on the radar:

### Schema-fingerprint cache to skip redundant `apply schema App`

Quereus' `apply schema` is supposed to no-op when the schema text matches what's materialized. If the timing logs show `executeSchema` taking >50ms on every cold start (after lazy/parallel land), store a hash of the schema DDL alongside the strand id in MMKV and skip the `db.exec(wrappedSchema)` call when the hash matches.

Risk: if Quereus' diff is already a no-op cheaply, this saves nothing. Measure first.

### Share crypto-plugin / optimystic-plugin instances between control and strand DBs

Today `ControlDatabase.initialize()` and `StrandDatabase.initialize()` each register their own copy of `@optimystic/quereus-plugin-crypto` and `@optimystic/quereus-plugin-optimystic`. Plugin registration constructs a `CollectionFactory` and registers vtables / functions per Database instance.

It's not clear that Quereus' Database type permits sharing a plugin's collection factory across two Database instances — each factory is wired to a specific libp2p node via `registerLibp2pNode(networkName, ...)`. The control and strand use different libp2p nodes and different network names, so a single factory would need to multiplex. Not obviously cheaper than just paying the second registration.

Investigate only if `optimysticPlugin` registration shows up dominant in the timing logs after the parallelization lands.

### `getOrCreateValue` (AsyncStorage) reads on the critical path

`partyId` and `healthStrandId` are loaded from AsyncStorage in `doStart`. Each is typically <5ms. If the timing logs ever show otherwise, batch them into a single `multiGet` or move them into the encrypted MMKV instance the peer-identity work introduced.

## TODO (when revisiting)

- Confirm post-parallelization timings to identify which (if any) of these still matter
- For schema-fingerprint cache: prototype the MMKV store + early-return path in `StrandDatabase.executeSchema`; measure delta
- For plugin sharing: read `quereus-plugin-optimystic`'s factory ownership model; only proceed if a clean sharing API exists
- Drop or convert this ticket to active implement work once measurements arrive
