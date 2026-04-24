description: Full polyfill alignment with sereus reference app once upstream upgrades land
prereq: sereus ticket plan/3-reference-app-polyfill-upgrades (must be completed first)
files: apps/mobile/index.js, apps/mobile/metro.config.js, apps/mobile/package.json
----
## Blocked on: sereus upstream polyfill upgrades

Sereus's own polyfill upgrade ticket (`sereus/tickets/plan/3-reference-app-polyfill-upgrades.md`) needs to land first. That ticket will:
- Upgrade `crypto.getRandomValues` from `Math.random()` to `react-native-get-random-values`
- Upgrade `structuredClone` from JSON round-trip to `@ungap/structured-clone`
- Add Web Streams API polyfill
- Add `Symbol.asyncIterator` polyfill
- Update documentation with quality guidance

Sereus-health already has all of these with production-quality implementations. Once sereus upgrades, we can evaluate convergence.

## Questions to resolve once unblocked

**1. Shared polyfill module vs. separate copies?**
Can sereus publish its polyfills as an importable module (e.g. `@sereus/polyfills-rn`) that downstream apps can use instead of maintaining copies? This would be ideal but requires sereus to support the pattern. If not practical, sereus-health should at minimum match the same packages/approaches.

**2. EventTarget polyfill convergence**
Sereus-health uses the `event-target-polyfill` npm package. Sereus uses custom inline EventTarget/Event/CustomEvent classes in `polyfills/event.js`. Both work, but they should converge to avoid subtle behavioral differences. The npm package may be more spec-complete (handles `once`, capture options, etc.).

**3. Package alignment**
Once sereus upgrades, verify both apps use the same packages:
- `react-native-get-random-values` for crypto.getRandomValues
- `@ungap/structured-clone` for structuredClone
- `web-streams-polyfill` for Web Streams
- `@noble/hashes` for crypto.subtle.digest and Node.js crypto shim

## Current state (for context when revisiting)

Sereus-health has better implementations than upstream for:
| Polyfill | sereus-health | sereus (current) |
|----------|--------------|------------------|
| crypto.getRandomValues | `react-native-get-random-values` (native) | `Math.random()` fallback |
| structuredClone | `@ungap/structured-clone` (spec-compliant) | `JSON.parse(JSON.stringify())` |
| Web Streams | `web-streams-polyfill` | missing |
| Symbol.asyncIterator | custom polyfill | missing |
| EventTarget | `event-target-polyfill` package | custom inline class |

Sereus-health is not "behind" — it's ahead. The alignment goal is convergence, not catch-up.
