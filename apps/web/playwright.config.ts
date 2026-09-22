import { defineConfig, devices } from '@playwright/test';

/**
 * Doc 13 §6: 8 scenarios, sequential (transcode concurrency is 1), Chrome
 * for everything, Firefox/Safari for the player subset. Target is the full
 * stack behind nginx, so `make up` first.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grep: /@player/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@player/ },
  ],
});
