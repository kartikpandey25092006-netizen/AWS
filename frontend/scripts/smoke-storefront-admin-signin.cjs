const assert = require('node:assert/strict')
const puppeteer = require('puppeteer')

const storefrontUrl = process.env.STOREFRONT_URL || 'http://127.0.0.1:5173/'
const origin = new URL(storefrontUrl).origin
const cors = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization,content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
}

// These unsigned fixtures are confined to intercepted browser requests. They are
// never sent to the real Store API or Cognito and cannot authenticate there.
function fixtureToken(claims) {
  return [
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'local-test-signature',
  ].join('.')
}

async function checkLogin(browser, { name, entry, groups, approvalStatus, delayedApproval = false }) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  const errors = []
  const approvals = []
  let authority
  let authorizeParams
  let adminReads = 0
  let approvalRequests = 0
  let holdApproval = delayedApproval
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    const url = new URL(request.url())
    const json = (status, body) => request.respond({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) })
    if (url.pathname.endsWith('/.well-known/openid-configuration')) {
      authority = request.url().replace('/.well-known/openid-configuration', '')
      return json(200, {
        issuer: authority,
        authorization_endpoint: 'https://auth.example.test/authorize',
        token_endpoint: 'https://auth.example.test/token',
        jwks_uri: 'https://auth.example.test/jwks',
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
      })
    }
    if (url.hostname === 'auth.example.test' && url.pathname === '/authorize') {
      authorizeParams = url.searchParams
      const callback = new URL(authorizeParams.get('redirect_uri'))
      assert.equal(callback.origin, origin)
      callback.searchParams.set('code', 'local-fixture-code')
      callback.searchParams.set('state', authorizeParams.get('state'))
      return request.respond({ status: 302, headers: { Location: callback.href } })
    }
    if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers: cors })
    if (url.hostname === 'auth.example.test' && url.pathname === '/token') {
      const now = Math.floor(Date.now() / 1000)
      const claims = {
        iss: authority, aud: authorizeParams.get('client_id'), sub: 'local-test-user',
        email: 'local-user@example.test', iat: now, exp: now + 3600,
        ...(authorizeParams.has('nonce') ? { nonce: authorizeParams.get('nonce') } : {}),
      }
      return json(200, {
        id_token: fixtureToken(claims),
        access_token: fixtureToken({ ...claims, 'cognito:groups': groups }),
        token_type: 'Bearer', expires_in: 3600, scope: 'openid email profile',
      })
    }
    if (url.pathname === '/api/admin/session') {
      approvalRequests++
      const respond = () => json(approvalStatus, approvalStatus === 200
        ? { role: 'store-admin' }
        : { error: { code: approvalStatus === 403 ? 'FORBIDDEN' : 'UNAVAILABLE', message: 'Administrator verification unavailable.' } })
      if (holdApproval) { approvals.push(respond); return }
      return respond()
    }
    if (url.pathname === '/api/admin/orders') { adminReads++; return json(200, { orders: [] }) }
    if (url.pathname === '/api/orders/me') return json(200, { orders: [] })
    if (url.pathname === '/api/products') return json(200, { products: [] })
    if (url.origin !== origin) return request.abort()
    return request.continue()
  })

  try {
    console.log(`RUN: ${name}`)
    await page.goto(storefrontUrl, { waitUntil: 'networkidle2' })
    const label = entry === 'admin' ? 'Admin sign in' : 'Customer sign in'
    // Match the visible label without relying on the order of navigation items.
    let clicked = false
    for (const candidate of await page.$$('.store-nav button')) {
      if (await candidate.evaluate((node) => node.textContent) === label) {
        await candidate.click()
        clicked = true
        break
      }
    }
    assert(clicked, `${label} is unavailable; start a storefront with Cognito configuration`)

    if (delayedApproval) {
      await page.waitForFunction(() => document.body.innerText.includes('Checking your session'))
      for (let attempt = 0; !approvals.length && attempt < 50; attempt++) await new Promise((resolve) => setTimeout(resolve, 20))
      assert(approvals.length > 0, 'admin approval must be requested')
      assert.equal(adminReads, 0, 'admin orders must not load before server approval')
      assert.equal(await page.$('.store-signout'), null, 'the session must remain blocked during verification')
      holdApproval = false
      await Promise.all(approvals.splice(0).map((respond) => respond()))
    }

    if (entry === 'customer') {
      await page.waitForFunction(() => document.body.innerText.includes('No orders yet'))
      assert.equal(approvalRequests, 0, 'customer sign-in must remain independent of admin checks')
    } else if (approvalStatus === 200) {
      for (let attempt = 0; !adminReads && attempt < 200; attempt++) await new Promise((resolve) => setTimeout(resolve, 25))
      await page.waitForFunction(() => document.body.innerText.includes('No orders to review'))
      assert(adminReads > 0)
      assert(await page.$('.store-signout'))
    } else {
      await page.waitForFunction(() => document.body.innerText.includes('Sign-in could not be completed'))
      if (approvalStatus === 403) assert.match(await page.$eval('.store-state-panel', (node) => node.textContent), /restricted to approved administrators/)
      await page.waitForFunction(() => !Object.keys(sessionStorage).some((key) => key.startsWith('oidc.user:')))
      assert.equal(adminReads, 0, 'rejected login must not fetch admin data')
      assert.equal(await page.$('.store-signout'), null, 'rejected login must not leave a signed-in session')
      assert.equal(await page.$eval('.store-portal-title', (node) => node.textContent.includes('Signed in as')), false)
      assert(await page.$('.store-state-panel .store-outline-action'), 'customer sign-in must be offered after rejection')
      await page.reload({ waitUntil: 'networkidle2' })
      assert.match(await page.$eval('.store-state-panel', (node) => node.textContent), /Administrator sign-in required/)
    }

    assert.equal(new URL(page.url()).pathname, entry === 'admin' ? '/admin/orders' : '/account/orders')
    assert.equal(authorizeParams.get('prompt'), 'login')
    assert.equal(authorizeParams.get('code_challenge_method'), 'S256')
    assert.deepEqual(errors, [])
    console.log(`PASS: ${name}`)
  } finally {
    await context.close().catch(() => undefined)
  }
}

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
  })
  try {
    for (const scenario of [
      { name: 'customer attempting admin sign-in is rejected and session cleared', entry: 'admin', groups: [], approvalStatus: 403 },
      { name: 'lookalike group cannot sign in as admin', entry: 'admin', groups: ['store-admins'], approvalStatus: 403 },
      { name: 'server rejection overrides an admin claim in the browser', entry: 'admin', groups: ['store-admin'], approvalStatus: 403 },
      { name: 'API unavailability fails closed and clears attempted session', entry: 'admin', groups: ['store-admin'], approvalStatus: 503 },
      { name: 'approved administrator waits for server approval before entering', entry: 'admin', groups: ['store-admin'], approvalStatus: 200, delayedApproval: true },
      { name: 'customer sign-in still returns to customer orders', entry: 'customer', groups: [], approvalStatus: 403 },
    ]) await checkLogin(browser, scenario)
  } finally {
    await browser.close().catch(() => undefined)
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
