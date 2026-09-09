import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  // The instance is a single shared server with one database, so specs that
  // write to the same scenario must not interleave.
  workers: 1,
  fullyParallel: false,
  // A flaky autosave test is a real autosave bug; retrying would hide exactly
  // what this suite exists to catch.
  retries: 0,
  timeout: 90_000,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    trace: 'retain-on-failure',
    launchOptions: { args: ['--no-sandbox'] },
  },
})
