# Cadre Management

Apps rely on [@sereus/cadre-core](https://github.com/gotchoices/sereus.git) for cadre and strand management.

For architecture, enrollment flows, and API details, see `sereus/docs/cadre-architecture.md`.

## Storage Architecture

Health data is stored in an **optimystic strand database** managed by CadreNode.
On first run the app auto-generates a party ID and starts a local health
strand via `addStrand()`. No authority key or networking setup is required
for local storage — the user logs data immediately.

Authority keys, CadrePeer registration, and control-DB strand entries are
created automatically when the user first adds a remote node. After that,
health data replicates to the new node automatically.

The previous `rn-leveldb` storage backend is deprecated; migration to
optimystic (`IRawStorage` / `MMKVRawStorage`) is in progress.

## Implementation References

- **CadreNode API**: `sereus/packages/cadre-core/README.md`
- **Control database schema**: `sereus/docs/cadre-architecture.md` — `AuthorityKey`, `CadrePeer`, `Strand` tables; query via Quereus SQL (`db.eval()`)
- **Storage**: `@optimystic/db-p2p` `IRawStorage`; RN: `@optimystic/db-p2p-storage-rn` (`MMKVRawStorage`)
- **Enrollment flows**: `sereus/docs/cadre-architecture.md` — seed bootstrap, four modes (phone→drone, server→phone, server→drone, phone→phone via relay)
- **RN transports**: `webSockets()` + `circuitRelayTransport()` (no TCP in RN); bootstrap/relay via DNSADDR

## Core Concepts

- **Cadre**: A user's personal cluster of devices (phone, server, NAS, etc.)
- **Party ID**: UUID identifier for the cadre; auto-generated on first run
- **Control Network**: Private database shared by cadre nodes (manages membership and strands)
- **Strand**: Shared data space backed by an optimystic database
- **Strand Guests**: Third parties with strand-level access (e.g., a doctor)

## Authority Keys

Keys authorize cadre changes (adding nodes, inviting guests). The schema permits one bootstrap insert without existing authorization (`count(AuthorityKey) <= 1`).

- **Local vault**: Keychain/Keystore; biometric or login protection
- **External**: exportable as JWK file or QR code
- **Dongle**: hardware signing device (future)

When signing: search local vault first; if not found, prompt for external key.

## Peer Identity

Each device has a stable Ed25519 peer identity used for all libp2p networks
(control and strands). The private key is stored in an encrypted MMKV instance
(`sereus-peer-identity`). This is a lower-stakes key than authority keys —
migration to Keychain/Keystore is deferred until biometric protection is needed.
The dev reset flow clears the stored key so a fresh identity is generated.

## Enrollment

- **Phone adds drone/server**: `createSeed()` → deliver via provider API → dial
- **Server adds phone**: scan QR/link (partyId + multiaddr) → dial server
- **Phone adds phone** (future): relay-routed multiaddr via `getRelayAddress()`

The NAT'd device always dials out to the publicly-reachable device.
