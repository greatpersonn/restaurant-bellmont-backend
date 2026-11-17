module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.test.json' }] },
  testEnvironment: 'node',
};
