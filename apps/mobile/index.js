/**
 * @format
 */

// Must be the first import: sets process.env.DEBUG before 'debug' initializes.
import './src/debug-bootstrap';

// Polyfill: Timer .ref() / .unref()
// Node.js timers return objects with .ref()/.unref(); Hermes returns plain numbers.
// Required by: @optimystic/db-p2p (cluster-repo), undici, libp2p internals.
// Also patches clearTimeout/clearInterval to unwrap, since RN's native clear
// functions expect the raw numeric ID.
const _origSetTimeout = globalThis.setTimeout;
const _origSetInterval = globalThis.setInterval;
const _origClearTimeout = globalThis.clearTimeout;
const _origClearInterval = globalThis.clearInterval;

function _unwrapTimer(handle) {
  return (handle && typeof handle === 'object' && '_id' in handle)
    ? handle._id
    : handle;
}
function _wrapTimer(id) {
  if (typeof id === 'object' && id !== null) return id;
  return {
    _id: id,
    ref() { return this; },
    unref() { return this; },
    [Symbol.toPrimitive]() { return this._id; },
  };
}
globalThis.setTimeout = function patchedSetTimeout(...args) {
  return _wrapTimer(_origSetTimeout.apply(this, args));
};
Object.assign(globalThis.setTimeout, _origSetTimeout);
globalThis.setInterval = function patchedSetInterval(...args) {
  return _wrapTimer(_origSetInterval.apply(this, args));
};
Object.assign(globalThis.setInterval, _origSetInterval);
globalThis.clearTimeout = function patchedClearTimeout(handle) {
  return _origClearTimeout.call(this, _unwrapTimer(handle));
};
globalThis.clearInterval = function patchedClearInterval(handle) {
  return _origClearInterval.call(this, _unwrapTimer(handle));
};

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

// Polyfill for TextDecoder (UTF-8 only).
// Bare RN 0.85 Hermes ships TextEncoder but NOT TextDecoder; Expo SDK 52+
// Hermes includes both.  Required by `uint8arrays/util/bases` (module-scope
// `new TextDecoder('utf8')`), which is pulled in by libp2p/yamux/multiformats
// at import time — so yamux's default export resolves to undefined and
// CadreNode.start() blows up with "Cannot read property 'Yamux' of undefined".
if (typeof globalThis.TextDecoder === 'undefined') {
  class TextDecoderPolyfill {
    constructor(label = 'utf-8') {
      const enc = String(label).toLowerCase().replace('_', '-');
      if (enc !== 'utf-8' && enc !== 'utf8') {
        throw new RangeError(`TextDecoder polyfill only supports UTF-8 (got "${label}")`);
      }
      this.encoding = 'utf-8';
      this.fatal = false;
      this.ignoreBOM = false;
    }
    decode(input) {
      if (input == null) return '';
      const bytes = input instanceof Uint8Array
        ? input
        : ArrayBuffer.isView(input)
          ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
          : new Uint8Array(input);
      if (bytes.length === 0) return '';
      let i = 0;
      let str = '';
      // Skip UTF-8 BOM
      if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) i = 3;
      while (i < bytes.length) {
        const b = bytes[i++];
        if (b < 0x80) {
          str += String.fromCharCode(b);
        } else if (b < 0xC0) {
          str += '\uFFFD';
        } else if (b < 0xE0) {
          str += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i++] & 0x3F));
        } else if (b < 0xF0) {
          str += String.fromCharCode(
            ((b & 0x0F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F),
          );
        } else {
          let cp = ((b & 0x07) << 18)
            | ((bytes[i++] & 0x3F) << 12)
            | ((bytes[i++] & 0x3F) << 6)
            | (bytes[i++] & 0x3F);
          cp -= 0x10000;
          str += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
        }
      }
      return str;
    }
  }
  globalThis.TextDecoder = TextDecoderPolyfill;
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

// Polyfill for Intl.PluralRules (English-only).
// moat-maker (dep of optimystic) calls new Intl.PluralRules('en', { type: 'ordinal' })
// at module scope for ordinal formatting in error messages.
if (typeof Intl !== 'undefined' && typeof Intl.PluralRules === 'undefined') {
  const ordinalRules = (n) => {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'one';
    if (mod10 === 2 && mod100 !== 12) return 'two';
    if (mod10 === 3 && mod100 !== 13) return 'few';
    return 'other';
  };
  const cardinalRules = (n) => (n === 1 ? 'one' : 'other');
  Intl.PluralRules = class PluralRules {
    constructor(_locale, options) { this._type = options?.type === 'ordinal' ? 'ordinal' : 'cardinal'; }
    select(n) { return this._type === 'ordinal' ? ordinalRules(n) : cardinalRules(n); }
    resolvedOptions() { return { type: this._type, locale: 'en' }; }
  };
}

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
