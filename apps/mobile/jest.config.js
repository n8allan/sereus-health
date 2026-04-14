module.exports = {
  preset: '@react-native/jest-preset',
  moduleNameMapper: {
    '^@noble/hashes/(.+)$': '<rootDir>/node_modules/@noble/hashes/$1.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|react-native-.*|@noble/hashes)/)',
  ],
};
