import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 120_000,
  expect: {timeout: 10_000},
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['line'],
    ['html', {outputFolder: 'playwright-report', open: 'never'}],
    ['json', {outputFile: 'results/raw/playwright-report.json'}],
  ],
  use: {
    ...devices['Desktop Chrome'],
    viewport: {width: 1440, height: 900},
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

