module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/tests/*.ui.test.tsx'],
  modulePathIgnorePatterns: ['<rootDir>/.cache/'],
  clearMocks: true,
  cacheDirectory: '<rootDir>/.cache/jest',
};
