description: Investigate and reduce cadre cold-start latency on the mobile app
dependencies: timing logs added to `CadreService.doStart()` (already in place); useful to land alongside the peer-identity persistence ticket since the two share critical-path code
files:
  - apps/mobile/src/services/CadreService.ts (timing logs added)
  - apps/mobile/src/db/index.ts
  - C:/projects/sereus/packages/cadre-core/src/cadre-node.ts
  - C:/projects/sereus/packages/cadre-core/src/control-database.ts
  - C:/projects/sereus/packages/cadre-core/src/strand-instance-manager.ts
  - C:/projects/sereus/packages/cadre-core/src/strand-database.ts
  - C:/projects/optimystic/packages/db-p2p/src/libp2p-node-base.ts
----
## Context

The user reports that cadre creation on app cold start is "really slow." The work done by `CadreService.doStart()` is substantial:

1. Load `partyId` from AsyncStorage (cheap).
2. `new CadreNode(config)` (cheap; just constructs managers).
3. `node.start()` — heavy:
   - `createLibp2pNode()` for the **control** network: Ed25519 keypair generation, libp2p init with `identify`, `ping`, `gossipsub`, `cluster`, `repo`, `sync`, `networkManager`, `fret`, optional `circuitRelayServer`, then `node.start()`, then `Libp2pKeyPeerNetwork.initFromPersistedState`, `clusterMember(...)`, `coordinatorRepo(...)`, Arachnode setup with `StorageMonitor` + `RingSelector` + `RestorationCoordinator`, and a 60s monitor `setInterval`.
   - `new ControlDatabase(...)` + `initialize()`: creates a Quereus `Database`, registers `quereus-plugin-crypto`, registers `quereus-plugin-optimystic` (which builds a `CollectionFactory` and registers vtables/functions), then `loadSchema()` which `db.exec`s the entire `CadreControl` DDL (6 tables with constraint checks).
   - `new StrandWatcher(...)` + `start()`: begins polling `Strand` table every 5s.
   - `HibernationManager.start()`.
   - Background `scheduleSelfRegistration` (currently a no-op log).
4. `node.addStrand(...)` — *another* heavy block, comparable in cost to step 3:
   - `createLibp2pNode()` for the **strand** network — second full libp2p stack.
   - `new StrandDatabase(...)` + `initialize()`: another Quereus `Database`, another crypto + optimystic plugin registration, another `CollectionFactory`, then schema apply via `declare schema App { ... } apply schema App` (the health schema from `design/specs/domain/schema.qsql`).

So **two full libp2p nodes plus two Quereus databases plus two optimystic plugin instances plus two schema applies** all happen serially on cold start before the first screen can read data. The strand work happens **inside** `doStart`, so the user blocks on it.

`CadreService.doStart()` now logs per-stage timing (`partyId load`, `cadreNode.start (control libp2p + control DB)`, `addStrand (strand libp2p + strand DB + schema apply)`, total) so we can see where the time actually goes before deciding what to fix. **Do this measurement first** — speculation about which step dominates is not useful; the answer is in the logs.

## Hypotheses to validate against the timings

- **Two libp2p nodes is the dominant cost.** Each instance generates an Ed25519 keypair, wires up ~10 services, and starts an Arachnode `setInterval`. If true, the biggest wins are (a) lazy strand bring-up (don't start the strand until first data access) or (b) parallelizing the two libp2p starts.
- **Quereus plugin registration is non-trivial.** `optimysticPlugin(db, ...)` builds a `CollectionFactory`. We register the same crypto + optimystic plugins twice (once per DB). If plugin init is heavy, consider whether one shared optimystic plugin instance can serve both databases (currently each DB owns its own factory and registers its own libp2p node into it).
- **Schema apply is non-trivial.** `apply schema CadreControl` (6 tables with ed25519/digest checks) and `apply schema App` (the health schema) both run every cold start, even when the schema is already materialized in storage. Quereus' apply is supposed to no-op when there's no diff, but worth confirming. If it does redundant work, we can guard with a "schema fingerprint" stored alongside the strand.
- **Arachnode init does I/O.** `StorageMonitor` + `RingSelector.createArachnodeInfo()` reads storage stats during `createLibp2pNodeBase`. If MMKV-backed storage is slow to enumerate, this lands on the critical path.

## Possible interventions (apply after measurements)

Roughly ordered by expected ROI per effort:

1. **Lazy strand bring-up.** Move `addStrand` out of `doStart` and into the first call to `getHealthDatabase()` (or a separate `ensureStrandReady()`). The first screen the user sees doesn't always need health data; the SereusConnections screen, for example, only needs the control DB. This roughly halves cold-start latency for screens that don't immediately read health data.
2. **Parallelize the two libp2p starts.** `addStrand` requires `node.running === true`, but the *libp2p part* of strand startup is independent of the control node once the control node has started. We could begin strand libp2p creation immediately after `node.start()` resolves, in parallel with the control DB initialization (which happens inside `node.start()` today — would require a small refactor).
3. **Skip Arachnode for small-cadre profiles.** `arachnode.enableRingZulu` defaults to true. For a phone with a single local strand and no remote peers, the storage-ring monitoring is pure overhead. Add a `profile: 'transaction'` shortcut in `createLibp2pNodeBase` that skips the Arachnode block entirely.
4. **Defer the strand watcher's first poll.** It currently kicks off immediately and polls every 5s; for a single-device cadre with no remote peers this contributes nothing useful and competes for the JS thread during startup.
5. **Cache the schema fingerprint.** If `apply schema App` measurably re-validates the schema each launch, store a hash of the schema text in MMKV next to the strand and skip the apply when it matches.
6. **Share crypto-plugin / optimystic-plugin registrations between control and strand DBs**, if Quereus permits. Today each `Database` instance gets its own copy.
7. **Move `extractInnerDDL` to module load**, not `doStart`. (Already module-level in current code; just confirm.)
8. **Move `getOrCreateValue` calls out of the critical path** if they show up — they're AsyncStorage reads and are usually <5ms but worth eyeballing.

## Tests / validation

- Capture timing baseline: cold start the app three times, record `CadreService.doStart total` and the per-stage values. Add to the ticket as the "before" number before any code changes.
- After each intervention, recapture the same three cold starts and report the delta.
- Make sure the SereusConnections screen and the LogHistory screen both still work end-to-end after each change (the lazy-strand change in particular has the highest regression risk).

## TODO

- Capture three cold-start timings from the new `CadreService` logs and paste them into this ticket as the baseline (do this *before* any code changes)
- Decide based on the baseline which of the interventions above to pursue, and split into separate `implement/` tickets per intervention
- Reasonable starting bet (subject to the measurements): lazy strand bring-up + skip Arachnode for the `transaction` profile
- After the implement tickets land, capture three more cold-start timings and confirm the improvement
