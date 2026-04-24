description: Defensive fix in optimystic — when a cluster for a block resolves to only the local peer, skip the self-sync round trip.  `CoordinatorRepo.fetchBlockFromCluster` currently invokes `clusterLatestCallback(selfPeerId, …)` which dials self via SyncClient; on a node with no listen addresses the dial never completes.
prereq: none in sereus-health — upstream change in optimystic repo.  Coordinate with optimystic repo owner before merging.
files:
  - C:/projects/sereus/packages/db-p2p/src/repo/coordinator-repo.ts (fetchBlockFromCluster → queryClusterForLatest short-circuit)
  - C:/projects/sereus/packages/db-p2p/src/libp2p-node-base.ts (clusterLatestCallback self-read fallback, ~line 334)
  - C:/projects/sereus/packages/db-p2p/src/repo/storage-repo.ts (getLatest — confirm accessible for self-read)
----

## Problem

When `findCluster(blockId)` returns a single peer that equals `node.peerId`, `CoordinatorRepo.fetchBlockFromCluster` still calls `queryClusterForLatest`, which invokes `clusterLatestCallback(selfPeerId, blockId)` and executes `new SyncClient(selfPeerId, …).requestBlock(…)` → `node.dialProtocol(selfPeerId, …)`.

Two concrete failure modes:

1. **Bare-RN / Hermes solo node** (sereus-health first-run): no listen addresses, no TCP transport, WebSocket-only.  The self-dial has no address to target, the libp2p dial queue holds it pending, and the outer `withTimeout(1000)` resolves but does not cancel the dial.  Repeated per CREATE TABLE during `apply schema`, producing what looks like a permanent stall.
2. **Any solo or single-peer cluster**: pointless round trip.  There is no remote to sync from.

Sibling ticket `cadre-solo-strand-bootstrap-mode.md` addresses the upstream caller (cadre-core routes schema DDL through NetworkTransactor when it shouldn't).  This ticket makes optimystic robust to the degenerate cluster=={self} case regardless of caller.

## Fix

Two layers, belt-and-suspenders:

1. **`CoordinatorRepo.fetchBlockFromCluster`** — after `findCluster`, if the result contains only the local peer, skip `queryClusterForLatest` entirely and return the local-miss outcome.  This is the correct short-circuit: there is no cluster-remote to read from.
2. **`clusterLatestCallback`** (`libp2p-node-base.ts` ~line 334) — if `peerId.equals(node.peerId)`, read directly from the local `storageRepo` (`.getLatest(blockId)` or equivalent) rather than constructing a `SyncClient` and dialing.  Guards any other caller path that reaches the callback with self as target.

Neither layer changes the observed behavior for multi-peer clusters — they only replace a self-dial with a local lookup.

## Out of scope

- Cancelling in-flight libp2p dials on `withTimeout` expiry — separate libp2p dial-queue concern.
- Upstream caller fix in cadre-core — sibling ticket 5.
- Reworking `findCluster` / `findCoordinator` semantics for solo nodes.

## TODO

- Confirm `storageRepo.getLatest(blockId)` (or the closest equivalent) is accessible from `libp2p-node-base` scope, either directly or via closure captured at callback construction.
- Add `peerId.equals(node.peerId)` short-circuit in `clusterLatestCallback`.
- Add single-peer-is-self short-circuit in `CoordinatorRepo.fetchBlockFromCluster`.
- Unit test: solo-cluster block fetch returns local value (or undefined) without any libp2p dial — assert `node.dialProtocol` is not called.
- Unit test: multi-peer cluster behaviour unchanged.
- File upstream PR against optimystic; link back here on merge.
