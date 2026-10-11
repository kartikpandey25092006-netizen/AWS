const assert = require('node:assert/strict')
const puppeteer = require('puppeteer')

const storefrontUrl = process.env.STOREFRONT_URL || 'http://127.0.0.1:4173/'
const cloudOpsUrl = process.env.CLOUDOPS_URL || 'http://127.0.0.1:4174/'

async function run() {
  const launchOptions = { headless: true }
  if (process.env.PUPPETEER_EXECUTABLE_PATH) launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
  const browser = await puppeteer.launch(launchOptions)
  try {
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto(storefrontUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    assert.match(await page.title(), /Fieldwork/)
    assert.match(await page.$eval('h1', (node) => node.textContent || ''), /Make room/)
    await page.click('button[aria-label="Add Orbit Desk Lamp to bag"]')
    await page.waitForFunction(() => document.querySelector('.store-cart-button b')?.textContent?.trim() === '1')
    await page.click('button[aria-label="Open cart with 1 items"]')
    assert.match(await page.$eval('.store-demo-callout', (node) => node.textContent || ''), /No payment is collected/)
    await page.$$eval('button', (buttons) => buttons.find((button) => button.textContent?.includes('Place demo order'))?.click())
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes('Demo order placed'))

    await page.goto(cloudOpsUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    await page.waitForFunction(() => /Authentication Required|CloudOps sign-in is not configured/.test(document.body.innerText))
    assert.equal(await page.$('.bento-grid'), null, 'unauthenticated visitors must not see CloudOps metrics')
    assert.deepEqual(pageErrors, [], 'browser errors: ' + pageErrors.join('; '))
    console.log('Frontend smoke checks passed: storefront cart/checkout and unauthenticated dashboard lock.')
  } finally {
    await browser.close()
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
