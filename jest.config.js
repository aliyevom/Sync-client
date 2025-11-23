module.exports = {
  testMatch: [
    '**/__tests__/**/*.{js,jsx,ts,tsx}',
    '**/*.{spec,test}.{js,jsx,ts,tsx}'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/build/'
  ],
  // Explicitly set rootDir to handle paths with special characters
  rootDir: process.cwd(),
  // Use a more explicit pattern that doesn't rely on regex character classes
  testRegex: [
    '(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$'
  ]
};

