description: Per-strand lifecycle mode (`bootstrap` | `networked`) threaded through cadre-core and persisted in CadreService so solo RN nodes apply schema DDL via the local transactor instead of the network transactor (which self-dials and hangs on bare Hermes with `listenAddrs: []`).
files:
  - C:/projects/sereus/packages/cadre-core/src/types.ts (new `StrandMode` union; `StrandConfig.mode?`)
  - C:/projects/sereus/packages/cadre-core/src/cadre-node.ts (forwards `mode` through `addStrand`)
  - C:/projects/sereus/packages/cadre-core/src/strand-instance-manager.ts (new `StartStrandConfig.mode?`)
  - C:/projects/sereus/packages/cadre-core/src/strand-database.ts (new `StrandDatabaseConfig.mode?`; selects `default_transactor`)
  - apps/mobile/src/services/CadreService.ts (`getOrCreateStrandMode`, `@sereus/strand/<id>/mode` key)
  - apps/mobile/src/db/reset.ts (clears the mode key alongside other strand state)
----

## What landed

A `StrandMode = 'bootstrap' | 'networked'` lifecycle type on the cadre-core surface.  Threaded end-to-end:

```
StrandConfig.mode
  → CadreNode.addStrand
  → StrandInstanceManager.startStrand (StartStrandConfig.mode)
  → StrandDatabase ctor (StrandDatabaseConfig.mode)
  → optimysticPlugin(default_transactor: 'local' | 'network')
  → db.setDefaultVtabArgs({ transactor: 'local' | 'network' })
```

`mode` is optional on every interface; when omitted, cadre-core defaults to `'networked'` — preserves the historical behavior for all existing callers (integration tests, reference-app-rn, cadre-cli).  Only CadreService on sereus-health explicitly opts into `'bootstrap'`.

CadreService persists mode under `@sereus/strand/<strandId>/mode` in AsyncStorage.  Fresh strands start as `'bootstrap'`; the value is read on every `ensureStarted` and passed through unchanged.  The `bootstrap → networked` flip is left to the enrollment flow (out of scope here; see STATUS.md Step 3).

`reset.ts` now removes the mode key alongside `@sereus/partyId` and `@sereus/healthStrandId` so dev-only resets don't leave a stale mode behind.

## Why

On bare-RN Hermes with `listenAddrs: []`, the previous unconditional `default_transactor: 'network'` routes every `CREATE TABLE` from `apply schema App` through `NetworkTransactor → findCoordinator → CoordinatorRepo.get → fetchBlockFromCluster → queryClusterForLatest → clusterLatestCallback → node.dialProtocol(selfPeerId, …)`.  With no listen addresses the self-dial has no target; the dial queue holds it indefinitely.  Per-CREATE-TABLE cost the first-run never finishes applying the schema.

`'local'` skips that entire path — schema DDL executes against the plugin's in-memory `LocalTransactor`, no libp2p involvement.

## Testing / validation

Use cases to exercise on review:

1. **Solo RN first-run** (new install, no peers):
   - `ensureStarted()` completes.
   - `CadreService` log shows `Adding health strand: <uuid> mode: bootstrap` and `Health strand ready`.
   - AsyncStorage now has `@sereus/strand/<id>/mode = bootstrap`.
   - `getHealthDatabase()` returns a queryable `Database`; e.g. a `SELECT * FROM log_entries` succeeds (empty result set, no error).

2. **Warm start** (subsequent launch, same install):
   - AsyncStorage already has the mode key; CadreService reads `'bootstrap'` and reuses it.
   - No self-dial, no schema re-DDL drama.  Verify `apply schema App` is idempotent against an already-populated optimystic schema tree (Quereus `apply schema` is declarative; no-op when the declared schema matches actual).

3. **Dev reset** (`resetDatabaseForDev`):
   - Mode key removed.  Next launch treats the strand as fresh and re-writes mode = `'bootstrap'`.

4. **Existing cadre-core callers** (integration tests, reference-app-rn, cadre-cli):
   - Unchanged — none of them pass `mode`; the default is `'networked'`.  All 127 cadre-core vitest specs still pass.

## Known caveat — data persistence in bootstrap mode

The optimystic plugin's `'local'` transactor backs writes with `MemoryRawStorage`, not the provided strand MMKV.  Practical consequences:

- **Schema DDL is fine** — nothing durable needs to survive.  On the next launch the schema is re-applied against a fresh in-memory schema tree; the `CREATE TABLE`s run again idempotently.
- **Data writes issued while in bootstrap mode do not persist across app restarts.**  A solo node that stays in bootstrap indefinitely (no enrollment) will lose user-entered data on relaunch.

The sibling ticket `4-optimystic-solo-cluster-self-sync-bypass.md` addresses the upstream caller so `'network'` mode becomes safe on solo nodes; once it lands, bootstrap mode becomes a schema-apply-only stage that transitions to networked on first write OR at first enrollment, and persistence is restored.  Reviewer should decide whether to:

  a. accept the caveat for solo-bootstrap and document it, treating bootstrap as "pre-enrollment, ephemeral" — acceptable if UX gates real data entry behind enrollment, OR
  b. extend the optimystic `'local'` transactor to use the registered `coordinatedRepo` when available (small plugin-side change — `createLocalTransactor` currently takes no options and ignores `registerLibp2pNode`), OR
  c. block this ticket on ticket 4 (networked-only path, no bootstrap/local distinction needed).

Recommendation: (a) short-term, document in AGENTS.md or STATUS.md; revisit once ticket 4 lands.

## Follow-ups out of scope

- `bootstrap → networked` transition at first remote-peer enrollment (restart-the-strand glue in CadreService).
- Control-DB strand row migration (move mode off AsyncStorage onto the row).
- `join` lifecycle mode for joining an existing strand on another peer.

## Tests

- cadre-core: all 127 vitest specs pass (no new specs added — mode plumbing is exercised via the existing `startStrand` tests, which all default to `'networked'`).
- sereus-health mobile: typecheck shows only pre-existing errors (`multiRemove` AsyncStorage typing, MMKV v4 `delete` signature, `Assistant.tsx` tuple index) unrelated to this change.
