const puppeteer = require('puppeteer');

const target = process.env.TARGET_URL || 'http://localhost:4173';

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.on('console', (message) => console.log('PAGE LOG:', message.text()));
    page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));
    await page.goto(target, { waitUntil: 'networkidle0', timeout: 30000 });
    console.log(`Loaded ${target}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error('Browser check failed:', error.message);
  process.exitCode = 1;
});
