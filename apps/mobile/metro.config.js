const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const defaultConfig = getDefaultConfig(__dirname);

// Workspace root (monorepo)
const workspaceRoot = path.resolve(__dirname, '../../..');

// Node.js built-in shims/stubs for libp2p transitive imports.
//   os, crypto — real shims providing subset APIs via react-native / @noble/hashes
//   net, tls   — empty stubs (never called at runtime)
const emptyShim = path.resolve(__dirname, 'shims/empty.js');
const osShim = path.resolve(__dirname, 'shims/node-os.js');
const cryptoShim = path.resolve(__dirname, 'shims/node-crypto.js');
const nodeBuiltinStubs = {
  os: osShim,
  'node:os': osShim,
  crypto: cryptoShim,
  'node:crypto': cryptoShim,
  net: emptyShim,
  'node:net': emptyShim,
  tls: emptyShim,
  'node:tls': emptyShim,
};

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * Allow importing shared workspace resources (e.g. `health/mock/data/*`)
 * while keeping `apps/mobile` as the RN app root.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [
    // Watch the health project root so Metro can resolve shared mock data.
    path.resolve(__dirname, '../..'),
    // Watch the workspace root so Metro can follow monorepo symlinks (e.g. portal deps).
    workspaceRoot,
    // Watch optimystic packages for direct resolution
    path.resolve(workspaceRoot, 'optimystic/packages'),
    // Watch sereus packages
    path.resolve(workspaceRoot, 'sereus/packages'),
    // Watch fret packages
    path.resolve(workspaceRoot, 'fret/packages'),
  ],
  transformer: {
    babelTransformerPath: require.resolve('./metro.transformer.js'),
  },
  resolver: {
    unstable_enableSymlinks: true,
    unstable_enablePackageExports: true,
    // Conditions for exports field resolution (order matters)
    unstable_conditionNames: ['import', 'require', 'default'],
    // Condition by platform
    unstable_conditionsByPlatform: {
      ios: ['react-native', 'import', 'require', 'default'],
      android: ['react-native', 'import', 'require', 'default'],
    },
    assetExts: defaultConfig.resolver.assetExts.filter(ext => ext !== 'qsql'),
    sourceExts: [...defaultConfig.resolver.sourceExts, 'qsql'],
    nodeModulesPaths: [
      // Mobile app's node_modules
      path.resolve(__dirname, 'node_modules'),
      // Health project root
      path.resolve(__dirname, '../../node_modules'),
      // Monorepo root (yarn workspaces hoists here)
      path.resolve(workspaceRoot, 'node_modules'),
      // Sereus workspace (for libp2p, etc.)
      path.resolve(workspaceRoot, 'sereus/node_modules'),
      // Optimystic workspace
      path.resolve(workspaceRoot, 'optimystic/node_modules'),
      // Quereus workspace
      path.resolve(workspaceRoot, 'quereus/node_modules'),
      // Fret workspace
      path.resolve(workspaceRoot, 'fret/node_modules'),
    ],
    // Map workspace packages to their actual locations (portal-like resolution)
    extraNodeModules: {
      // Optimystic packages (source)
      '@optimystic/quereus-plugin-crypto': path.resolve(workspaceRoot, 'optimystic/packages/quereus-plugin-crypto'),
      '@optimystic/quereus-plugin-optimystic': path.resolve(workspaceRoot, 'optimystic/packages/quereus-plugin-optimystic'),
      '@optimystic/db-core': path.resolve(workspaceRoot, 'optimystic/packages/db-core'),
      '@optimystic/db-p2p': path.resolve(workspaceRoot, 'optimystic/packages/db-p2p'),
      'p2p-fret': path.resolve(workspaceRoot, 'fret/packages/fret'),
      // Sereus packages (source)
      '@sereus/cadre-core': path.resolve(workspaceRoot, 'sereus/packages/cadre-core'),
      '@sereus/strand-proto': path.resolve(workspaceRoot, 'sereus/packages/strand-proto'),
      // Quereus packages (source)
      '@quereus/quereus': path.resolve(workspaceRoot, 'quereus/packages/quereus'),
      '@quereus/isolation': path.resolve(workspaceRoot, 'quereus/packages/quereus-isolation'),
      '@quereus/store': path.resolve(workspaceRoot, 'quereus/packages/quereus-store'),
      // Node.js built-in stubs (for libp2p transitive deps)
      ...nodeBuiltinStubs,
    },
    // Redirect Node-only packages to their RN-compatible entry points
    resolveRequest: (context, moduleName, platform) => {
      // Force @babel/runtime helpers to CJS.
      //
      // @babel/runtime's exports field lists conditions: node → import → default.
      // With 'import' active (needed for ESM-only packages like @libp2p/crypto),
      // Metro picks the ESM wrapper (export default), and require() receives
      // the module *object* instead of the helper *function*, causing:
      //   "TypeError: _interopRequireDefault is not a function (it is Object)"
      //
      // Node.js's require.resolve() uses the 'node' condition (first in the
      // exports map), so it always returns the CJS path.
      if (moduleName.startsWith('@babel/runtime/')) {
        try {
          return { type: 'sourceFile', filePath: require.resolve(moduleName) };
        } catch {
          // Fall through to default resolution
        }
      }

      // Note: @optimystic/db-p2p provides a "react-native" export condition
      // that resolves to ./dist/src/rn.js (no @libp2p/tcp).  Since
      // 'react-native' is in unstable_conditionsByPlatform, Metro resolves
      // this automatically — no manual redirect is needed.

      // Default resolution
      return context.resolveRequest(
        { ...context, resolveRequest: undefined },
        moduleName,
        platform,
      );
    },
  },
};

module.exports = mergeConfig(defaultConfig, config);
