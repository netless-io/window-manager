import type { PlaywrightTestConfig} from '@playwright/test';
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "example", ".env") });

const config: PlaywrightTestConfig = {
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    trace: 'on-first-retry',
    baseURL: "http://localhost:4000",
    headless: true,
  },
  timeout: 5 * 60 * 1000,
  workers: 4,
  projects: [
    {
      name: 'chrome',
      use: {
        launchOptions: {
            executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        }
        },
    },
  ],
  testDir: "./e2e",
};
export default config;