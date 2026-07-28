/**
 * Jest config for the sample's unit tests.
 *
 * These are pure logic tests - no AWS calls, no deployed stack required, so
 * `npm test` is safe to run before `cdk deploy`. The golden walkthrough in
 * README.md is the integration test and does need a live deployment.
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'CommonJS' } }],
  },
};
