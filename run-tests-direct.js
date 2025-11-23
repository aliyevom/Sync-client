#!/usr/bin/env node

/**
 * Direct test runner for client tests
 * This works around Jest/React Scripts issues with paths containing square brackets
 * 
 * Usage: node run-tests-direct.js
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('[OK] Running Client Tests Directly...\n');

// Change to client directory
process.chdir(__dirname);

// Run React Scripts test command
const testProcess = spawn('npm', ['test', '--', '--watchAll=false', '--passWithNoTests'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    CI: 'true'
  }
});

testProcess.on('close', (code) => {
  if (code === 0) {
    console.log('\n[OK] Client tests completed');
  } else {
    console.log(`\n[X] Tests exited with code ${code}`);
    console.log('Note: If you see "No tests found", this may be due to path issues.');
    console.log('Try running from client directory: cd client && npm test');
  }
  process.exit(code);
});

