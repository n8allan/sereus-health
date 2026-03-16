/**
 * @format
 */

// Must be the first import: sets process.env.DEBUG before 'debug' initializes.
import './src/debug-bootstrap';

// Polyfill for EventTarget + Event (needed by libp2p in RN/Hermes)
import 'event-target-polyfill';

// Polyfill for CustomEvent (event-target-polyfill doesn't include it;
// libp2p's safeDispatchEvent uses it internally)
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, params) {
      super(type, params);
      this.detail = params?.detail ?? null;
    }
  };
}

// Polyfill for Promise.withResolvers (ES2024; not yet in Hermes)
if (typeof Promise.withResolvers === 'undefined') {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

// Polyfill for AbortSignal.throwIfAborted (not yet in Hermes)
if (typeof AbortSignal !== 'undefined' &&
    typeof AbortSignal.prototype.throwIfAborted === 'undefined') {
  AbortSignal.prototype.throwIfAborted = function () {
    if (this.aborted) throw this.reason ?? new DOMException('The operation was aborted', 'AbortError');
  };
}

// Polyfill for crypto.getRandomValues (needed for UUIDv4 generation on RN/Hermes)
import 'react-native-get-random-values';

// Polyfill for crypto.subtle.digest (Web Crypto API).
// Hermes does not provide crypto.subtle; libp2p packages rely on it via
// multiformats/hashes/sha2-browser which calls crypto.subtle.digest().
// The official libp2p-react-native demo uses @peculiar/webcrypto + react-native-quick-crypto
// for a full Web Crypto polyfill.  We use a targeted digest-only polyfill with @noble/hashes
// to avoid adding native modules.
import { sha256 } from '@noble/hashes/sha2';
import { sha512 } from '@noble/hashes/sha2';
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {};
}
if (!globalThis.crypto.subtle) {
  globalThis.crypto.subtle = {
    digest: async (algorithm, data) => {
      const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
      const input = data instanceof Uint8Array ? data : new Uint8Array(data);
      if (name === 'SHA-256') return sha256(input).buffer;
      if (name === 'SHA-512') return sha512(input).buffer;
      throw new Error(`crypto.subtle.digest: unsupported algorithm ${name}`);
    },
  };
}

// Polyfill for TextEncoder/TextDecoder (used by Quereus plugins on RN/Hermes)
import 'fast-text-encoding';

// Polyfill for structuredClone (needed by Quereus in React Native)
import structuredClone from '@ungap/structured-clone';
if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = structuredClone;
}

// Polyfill for Web Streams API (needed by Vercel AI SDK in React Native)
import {
  ReadableStream,
  WritableStream,
  TransformStream,
} from 'web-streams-polyfill';
if (typeof global.ReadableStream === 'undefined') {
  global.ReadableStream = ReadableStream;
}
if (typeof global.WritableStream === 'undefined') {
  global.WritableStream = WritableStream;
}
if (typeof global.TransformStream === 'undefined') {
  global.TransformStream = TransformStream;
}

// Polyfill for Symbol.asyncIterator (required for async iterables / for-await-of in some RN/Hermes builds)
// Quereus isolation uses `Symbol.asyncIterator` explicitly when merging streams.
if (typeof Symbol !== 'undefined' && typeof Symbol.asyncIterator === 'undefined') {
  try {
    Object.defineProperty(Symbol, 'asyncIterator', {
      // Use the global symbol registry so independent polyfills converge on the same symbol.
      value: Symbol.for('Symbol.asyncIterator'),
      configurable: false,
      enumerable: false,
      writable: false,
    });
  } catch {
    // Best-effort fallback for runtimes that disallow defineProperty on Symbol.
    Symbol.asyncIterator = Symbol.for('Symbol.asyncIterator');
  }
}

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
