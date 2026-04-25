description: Defer health-strand bring-up until first health-DB access so cold-start screens that don't need health data (SereusConnections, Settings, ApiKeys, BackupRestore, Reminders) finish startup roughly half as fast as today.
prereq:
files:
  - apps/mobile/src/services/CadreService.ts
  - apps/mobile/src/db/index.ts
  - apps/mobile/src/data/sereusConnections.ts
  - apps/mobile/src/db/init.ts
----

## Goal

Today `CadreService.ensureStarted()` blocks the caller until both:

1. the control libp2p node + control DB are running, AND
2. the health strand's libp2p node + StrandDatabase are running (the second-half of `doStart`).

For SereusConnections and the other non-data screens, step 2 is wasted time on the critical path — those screens only read `cadreService.controlDatabase`. Defer step 2 until the first call that actually needs the health DB.

The intervention is local to `apps/mobile`; it does not require any cadre-core change.

## Approach

Split `CadreServiceImpl` readiness into two idempotent entry points:

- **`ensureControlReady()`** — runs the partyId/peerKey loads and `cadreNode.start()`. Returns when `controlDatabase` is queryable. Memoizes the in-flight promise.
- **`ensureStrandReady()`** — awaits `ensureControlReady()` and then runs `addStrand(...)`. Returns when `healthStrand.database` is set. Memoizes its own in-flight promise (separate from the control promise).

The legacy `ensureStarted()` becomes a thin alias for `ensureStrandReady()` so any caller we miss in the sweep still works (then we delete it once the sweep is verified — no shim left long-term).

Per-stage timing logs already in `doStart` need to survive the split so the before/after measurements stay comparable. Suggest: keep the same labels (`partyId load`, `cadreNode.start ...`, `addStrand ...`, total) and emit one `CadreService.controlReady total` and one `CadreService.strandReady total`.

### Caller migration

- `apps/mobile/src/db/index.ts` → `initOptimystic` switches to `ensureStrandReady()` (it returns `getHealthDatabase()`).
- `apps/mobile/src/data/sereusConnections.ts` → `ensureCadreStarted` switches to `ensureControlReady()`.
- Sweep `apps/mobile/src` for any other `ensureStarted` callers and route to whichever level they actually need.

### Concurrency

Both entry points must be safe under concurrent first-callers. Two simultaneous `ensureStrandReady()` calls share the strand promise; an `ensureControlReady()` interleaved with `ensureStrandReady()` shares the control promise. On error, the failed promise is cleared so a retry can start fresh (preserves today's `_startPromise = null` on throw semantics).

## Use cases / regression risks

- SereusConnections cold path: should finish roughly when `cadreNode.start` does (control + control DB only).
- LogHistory cold path: same total cost as today (control + strand still serial through `ensureStrandReady`).
- Switching SereusConnections → LogHistory: triggers strand bring-up exactly once, then stays cached across navigations.
- Switching LogHistory → SereusConnections → LogHistory: strand bring-up still happens once.
- A failed control bring-up should propagate to strand callers; a failed strand bring-up should NOT poison the control promise (so SereusConnections can still load even if the health strand fails).
- `closeDatabase()` / `cadreService.stop()` must reset both memoized promises.

## Validation

- Capture three cold-start baselines into LogHistory and three into SereusConnections (variant deep-link `?route=SereusConnections`); record `CadreService.doStart total` plus the per-stage labels. Paste into this ticket as the "before" numbers.
- After the change, capture three more of each. Expect SereusConnections cold-start total to drop by roughly the duration of the existing `addStrand` stage (typically dominated by the strand libp2p creation). LogHistory cold-start should be unchanged within noise.
- `npm test` in `apps/mobile`.
- Manual: SereusConnections shows party id and an empty peer list; navigating to LogHistory triggers strand bring-up and entries appear; reset → both still work.

## TODO

- Capture the three before-change baseline timings (LogHistory cold, SereusConnections cold) and paste them into this file
- Refactor `CadreServiceImpl` into `ensureControlReady` / `ensureStrandReady`, preserving in-flight promise semantics and per-stage timing labels
- Repoint `db/index.ts` (`initOptimystic`) at `ensureStrandReady`
- Repoint `data/sereusConnections.ts` (`ensureCadreStarted`) at `ensureControlReady`
- Sweep `apps/mobile/src` for any other `ensureStarted` callers; route each to the level it actually needs; remove the alias
- Update `cadreService.stop()` to clear both memoized promises
- Capture the three after-change timings; confirm the SereusConnections improvement and that LogHistory is unchanged
- Run `npm test`, lint, and typecheck in `apps/mobile`
