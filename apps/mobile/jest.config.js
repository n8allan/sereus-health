module.exports = {
  preset: '@react-native/jest-preset',
  moduleNameMapper: {
    '^@noble/hashes/(.+)$': '<rootDir>/node_modules/@noble/hashes/$1.js',
    '^@libp2p/crypto/(.+)$': '<rootDir>/node_modules/@libp2p/crypto/dist/src/$1/index.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|react-native-.*|@noble/hashes)/)',
  ],
};
