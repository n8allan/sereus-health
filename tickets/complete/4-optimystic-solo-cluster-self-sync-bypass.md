description: Defensive fix in optimystic — when a block's cluster resolves to only the local peer, `CoordinatorRepo.fetchBlockFromCluster` now short-circuits and never invokes `clusterLatestCallback`.  The callback itself (in `libp2p-node-base.ts`) additionally reads directly from local storage when targeted at self, so any other path reaching it with self as target is also safe.
prereq: cadre-solo-strand-bootstrap-mode
files:
  - C:/projects/optimystic/packages/db-p2p/src/repo/coordinator-repo.ts (solo-self short-circuit before `queryClusterForLatest`; `queryClusterForLatest` signature now takes pre-resolved peerIds)
  - C:/projects/optimystic/packages/db-p2p/src/libp2p-node-base.ts (`clusterLatestCallback` — self-read fallback against local `storageRepo` instead of `SyncClient` + self-dial)
  - C:/projects/optimystic/packages/db-p2p/test/coordinator-repo-solo-self-bypass.spec.ts (new spec — 5 cases)
----

## What landed

### 1. `CoordinatorRepo.fetchBlockFromCluster` (`coordinator-repo.ts`)

`fetchBlockFromCluster` now calls `findCluster` itself, detects the solo-self case (`peerIds.length === 1 && peerIds[0] === localPeerId.toString()`), and returns without invoking the cluster-latest callback.  `queryClusterForLatest` was refactored to accept the pre-resolved `peerIds: string[]` so the lookup isn't duplicated.

This is the correct short-circuit: when the cluster for a block is just us, there is no remote to sync from — the local miss is definitive.

### 2. `clusterLatestCallback` (`libp2p-node-base.ts`)

The callback now checks `peerId.equals(node.peerId)` before constructing a `SyncClient`.  For a self-target it reads directly via `storageRepo.get({ blockIds: [blockId], context })` and returns `result[blockId]?.state?.latest`.  This avoids `node.dialProtocol(selfPeerId, …)` entirely.

Belt-and-suspenders: CoordinatorRepo never calls the callback with self now, but this guards any other caller path (future or external) that might reach the callback with self as target.

### 3. Tests — `coordinator-repo-solo-self-bypass.spec.ts`

Five cases, all against `CoordinatorRepo` directly (no libp2p, no mesh):

1. **solo-self**: cluster=[self], callback never invoked.
2. **mixed cluster**: cluster=[self, other], callback invoked for both peers.
3. **empty cluster**: cluster={}, callback never invoked (pre-existing guard, pinned).
4. **single non-self**: cluster=[other], callback invoked for that peer — short-circuit does not over-fire.
5. **remote latest sync**: multi-peer cluster with a remote having newer rev; storage restoration call carries the discovered `ActionRev` context — multi-peer path unchanged.

## Why

Problem: `fetchBlockFromCluster` previously always called `queryClusterForLatest`, which always called `clusterLatestCallback(peerId, …)` for every cluster member including self.  In production the callback dials via `SyncClient` → `node.dialProtocol(selfPeerId, …)`.  On a node with no listen addresses (bare-RN Hermes, WebSocket-only, solo first-run), the self-dial has no target; the outer `withTimeout(1000)` resolves but does not cancel the pending dial.  Repeated per CREATE TABLE during schema apply, producing a permanent-looking stall.

Sibling ticket `cadre-solo-strand-bootstrap-mode` addressed the upstream caller (routed schema DDL through a local transactor to bypass this path).  This ticket makes optimystic robust to the degenerate `cluster == {self}` case regardless of caller, so `networked` mode becomes safe on solo nodes.  Once released, bootstrap mode in sereus-health can transition to networked at the first remote-peer enrollment without risking a fresh stall.

## Testing / validation

### Use cases to exercise on review

1. **Solo optimystic node** (the primary target): one peer, no bootstrap peers, memory storage.
   - `CoordinatorRepo.get({ blockIds: ['missing-block'] })` returns the local miss without attempting a self-dial.  Wall-clock well under the 1s callback timeout.
   - Same on a node configured with `listenAddrs: []` (WebSocket-only, Hermes-like) — no libp2p dial queue entries observed.

2. **Two-node network**: peer A writes a block, peer B reads it.
   - B's `get()` finds the block missing locally, `fetchBlockFromCluster` runs, calls the callback for A (not self), A's `SyncClient.requestBlock` returns the revision, B materializes.  Cross-node discovery still works.

3. **Three-node cluster, read-after-write on the writer**: writer commits, then immediately reads the same block on itself.
   - Block is already local → `localEntry.state.latest` is present → `fetchBlockFromCluster` is not entered.  No regression.

4. **Callback self-dial directly (hypothetical edge case)**: construct a callback invocation with `peerId = node.peerId`.
   - Self-read path hits `storageRepo.get` — no `SyncClient`, no `dialProtocol`.  Matches the local-only behavior the callback was supposed to approximate.

### Automated

- New spec: `test/coordinator-repo-solo-self-bypass.spec.ts` — 5/5 passing.
- Full `@optimystic/db-p2p` suite: **426 passing**, 5 pending.  No regressions.
- `tsc` build: clean.

### What this does NOT fix (intentionally out of scope)

- Cancelling in-flight libp2p dials on `withTimeout` expiry (separate libp2p dial-queue concern).
- Upstream caller fix in cadre-core (sibling ticket 3, already in review).
- Rethinking `findCluster` / `findCoordinator` semantics for solo nodes (larger design).

## Reviewer checks

- [ ] Do we want the `fetchBlockFromCluster` log channel named `cluster-fetch:solo-self-skip` distinguished from a generic `cluster-fetch:skip`?  Current name is explicit, keeps greppability.
- [ ] Is it worth inlining the `clusterLatestCallback` self-read at the CoordinatorRepo layer instead of libp2p-node-base?  Kept at libp2p-node-base to preserve the single construction site and because the CoordinatorRepo fix already prevents the call in the sereus-health path.  The belt-and-suspenders defense is cheap.
- [ ] Confirm with optimystic upstream owner before publishing — this is a behavioral change in a core path.
