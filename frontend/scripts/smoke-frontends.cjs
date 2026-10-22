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
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      if (request.url().endsWith('/api/products')) {
        request.respond({
          status: 200,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': new URL(storefrontUrl).origin },
          body: JSON.stringify({ products: [
            { id: 'orbit-desk-lamp', name: 'Orbit Desk Lamp', category: 'Workspace', priceCents: 6800, description: 'A warm, focused glow for long nights and big ideas.', color: 'sand', tag: 'Bestseller', inStock: true },
          ] }),
        })
        return
      }
      request.continue()
    })

    await page.goto(storefrontUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    assert.match(await page.title(), /Fieldwork/)
    assert.match(await page.$eval('h1', (node) => node.textContent || ''), /Make room/)
    await page.click('button[aria-label="Add Orbit Desk Lamp to bag"]')
    await page.waitForFunction(() => document.querySelector('.store-cart-button b')?.textContent?.trim() === '1')
    await page.click('button[aria-label="Open cart with 1 items"]')
    assert.match(await page.$eval('.store-cart-summary', (node) => node.textContent || ''), /Payment is not part of this order request/)
    await page.$$eval('button', (buttons) => buttons.find((button) => button.textContent?.includes('Sign in to submit'))?.click())
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes('sign-in is not configured'))

    await page.goto(new URL('/account/orders', storefrontUrl).toString(), { waitUntil: 'networkidle2', timeout: 30000 })
    assert.match(await page.$eval('.store-state-panel h2', (node) => node.textContent || ''), /sign-in is not configured/)
    await page.goto(new URL('/admin/orders', storefrontUrl).toString(), { waitUntil: 'networkidle2', timeout: 30000 })
    assert.match(await page.$eval('.store-state-panel h2', (node) => node.textContent || ''), /sign-in is not configured/)

    await page.goto(cloudOpsUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    await page.waitForFunction(() => /Authentication Required|CloudOps sign-in is not configured/.test(document.body.innerText))
    assert.equal(await page.$('.bento-grid'), null, 'unauthenticated visitors must not see CloudOps metrics')
    assert.deepEqual(pageErrors, [], 'browser errors: ' + pageErrors.join('; '))
    console.log('Frontend smoke checks passed: API-backed catalog, sign-in gates, account/admin routes, and unauthenticated dashboard lock.')
  } finally {
    await browser.close()
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
