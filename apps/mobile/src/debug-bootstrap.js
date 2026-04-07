// Bootstrap debug logging for sereus/optimystic/fret.
// This must be the first import in index.js so process.env.DEBUG is set
// before any 'debug' package instance initializes.
// React Native / Hermes lacks localStorage, so the debug package falls
// back to process.env.DEBUG.
if (!globalThis.process) globalThis.process = {};
if (!globalThis.process.env) globalThis.process.env = {};
//globalThis.process.env.DEBUG = 'sereus:cadre:*,optimystic:*';
