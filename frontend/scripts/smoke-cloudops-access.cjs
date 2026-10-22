const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')
const puppeteer = require('puppeteer')

const frontendRoot = path.resolve(__dirname, '..')
const authority = 'https://identity.example.test/local-user-pool'
const clientId = 'local-browser-access-test'
const cloudOpsOrigin = 'http://127.0.0.1:5180'
const storefrontOrigin = 'http://127.0.0.1:5181'
const cloudApiOrigin = 'https://cloud-api.example.test'
const storeApiOrigin = 'https://store-api.example.test'
const userKey = `oidc.user:${authority}:${clientId}`
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

// Unsigned fixtures are used only behind request interception. No AWS endpoint
// receives a request, token, credential, or configuration change from this test.
function fixtureToken(claims) {
  return [
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'local-test-signature',
  ].join('.')
}

function fixtureUser({ groups = [], idGroups = [], missingToken = false, malformedToken = false, expired = false } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const claims = { iss: authority, aud: clientId, client_id: clientId, sub: 'local-test-user', email: 'local-user@example.test', iat: now, exp: now + 3600 }
  return {
    id_token: fixtureToken({ ...claims, token_use: 'id', 'cognito:groups': idGroups }),
    access_token: missingToken ? '' : malformedToken ? 'invalid-token' : fixtureToken({ ...claims, token_use: 'access', 'cognito:groups': groups }),
    token_type: 'Bearer', scope: 'openid email profile', expires_at: expired ? now - 60 : now + 3600,
    profile: { ...claims, 'cognito:groups': idGroups },
  }
}

async function startVite(app, port) {
  const child = spawn(process.execPath, [
    path.join(frontendRoot, 'node_modules/vite/bin/vite.js'),
    '--config', `apps/${app}/vite.config.ts`, '--host', '127.0.0.1', '--port', String(port), '--strictPort',
  ], {
    cwd: frontendRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      VITE_COGNITO_AUTHORITY: authority, VITE_COGNITO_CLIENT_ID: clientId,
      VITE_STOREFRONT_COGNITO_AUTHORITY: authority, VITE_STOREFRONT_COGNITO_CLIENT_ID: clientId,
      VITE_API_URL: cloudApiOrigin, VITE_STOREFRONT_API_URL: storeApiOrigin,
      VITE_CLOUDOPS_URL: `${cloudOpsOrigin}/`,
      VITE_STOREFRONT_URL: `${storefrontOrigin}/`,
    },
  })
  let output = ''
  let spawnError
  child.stdout.on('data', (data) => { output = `${output}${data}`.slice(-6000) })
  child.stderr.on('data', (data) => { output = `${output}${data}`.slice(-6000) })
  child.on('error', (error) => { spawnError = error })
  try {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (spawnError) throw spawnError
      if (child.exitCode !== null) throw new Error(`${app} Vite exited: ${output}`)
      // Wait for this child to announce readiness before probing its port.
      if (output.includes(`127.0.0.1:${port}`)) {
        try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return child } catch { /* Still starting. */ }
      }
      await pause(100)
    }
    throw new Error(`${app} Vite did not start: ${output}`)
  } catch (error) {
    child.kill()
    throw error
  }
}

async function newPage(browser, { user = null, mobile = false, sessionStatus = 200, sessionBody = { role: 'store-admin' }, holdSession = false, networkFailure = false, seedStorefrontOnly = false, ssoOutcome = null, missingMemory = false, storeMetrics = null } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  const errors = []
  const calls = []
  const unexpected = []
  const held = []
  const deniedPaths = new Map()
  const authorizations = []
  let authorizationParams
  let holdApproval = holdSession
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', (dialog) => { void dialog.dismiss() })
  await page.setViewport(mobile ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1440, height: 1000 })
  await page.evaluateOnNewDocument(({ key, seed, onlyStorefront, storeOrigin }) => {
    // Preserve session removal on subsequent navigations in this context.
    if (!sessionStorage.getItem('local-test:seeded')) {
      if (seed && (!onlyStorefront || location.origin === storeOrigin)) sessionStorage.setItem(key, JSON.stringify(seed))
      sessionStorage.setItem('local-test:seeded', 'yes')
    }
    // Exercise multiple polls and their cleanup without a ten second wait.
    const originalInterval = window.setInterval.bind(window)
    window.setInterval = (handler, delay, ...args) => originalInterval(handler, delay === 10000 ? 100 : delay, ...args)
  }, { key: userKey, seed: user, onlyStorefront: seedStorefrontOnly, storeOrigin: storefrontOrigin })
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    void (async () => {
      const url = new URL(request.url())
      const origin = request.headers().origin || (request.frame() ? new URL(request.frame().url()).origin : cloudOpsOrigin)
      const cors = { 'Access-Control-Allow-Origin': origin === 'null' ? cloudOpsOrigin : origin, 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }
      const json = (status, body) => request.respond({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) })
      if (url.protocol === 'data:') return request.continue()
      if ([cloudOpsOrigin, storefrontOrigin].includes(url.origin)) return request.continue()
      if (request.method() === 'OPTIONS' && [cloudApiOrigin, storeApiOrigin, new URL(authority).origin].includes(url.origin)) return request.respond({ status: 204, headers: cors })
      if (url.href === `${authority}/.well-known/openid-configuration`) return json(200, {
        issuer: authority, authorization_endpoint: `${authority}/authorize`, token_endpoint: `${authority}/token`, jwks_uri: `${authority}/jwks`,
        response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
      })
      if (url.href.startsWith(`${authority}/authorize?`) && ssoOutcome) {
        authorizationParams = url.searchParams
        authorizations.push({ prompt: url.searchParams.get('prompt'), responseType: url.searchParams.get('response_type'), challengeMethod: url.searchParams.get('code_challenge_method') })
        const callback = new URL(url.searchParams.get('redirect_uri'))
        assert.equal(callback.origin, cloudOpsOrigin)
        callback.searchParams.set('state', url.searchParams.get('state'))
        callback.searchParams.set(ssoOutcome === 'expired' ? 'error' : 'code', ssoOutcome === 'expired' ? 'login_required' : 'local-sso-code')
        return request.respond({ status: 302, headers: { Location: callback.href } })
      }
      if (url.href === `${authority}/token` && ssoOutcome && ssoOutcome !== 'expired') {
        const exchange = new URLSearchParams(request.postData())
        assert.equal(exchange.get('grant_type'), 'authorization_code')
        assert(exchange.get('code_verifier'), 'SSO code exchange must use PKCE')
        const now = Math.floor(Date.now() / 1000)
        const claims = { iss: authority, aud: clientId, client_id: clientId, sub: 'local-sso-user', email: 'shared-admin@example.test', iat: now, exp: now + 3600 }
        if (authorizationParams.has('nonce')) claims.nonce = authorizationParams.get('nonce')
        return json(200, {
          id_token: fixtureToken({ ...claims, token_use: 'id' }),
          access_token: fixtureToken({ ...claims, token_use: 'access', 'cognito:groups': ssoOutcome === 'customer' ? [] : ['store-admin'] }),
          expires_in: 3600, token_type: 'Bearer', scope: 'openid email profile',
        })
      }
      if ([cloudApiOrigin, storeApiOrigin].includes(url.origin)) {
        calls.push({ path: url.pathname, method: request.method(), authorization: request.headers().authorization, body: request.postData() })
        if (url.origin === cloudApiOrigin && deniedPaths.has(url.pathname)) return json(deniedPaths.get(url.pathname), { error: { code: 'FORBIDDEN' } })
        if (url.origin === cloudApiOrigin && url.pathname === '/api/session') {
          if (networkFailure) return request.abort('connectionfailed')
          const respond = () => json(sessionStatus, sessionBody)
          if (holdApproval) { held.push(respond); return }
          return respond()
        }
        if (url.origin === cloudApiOrigin && url.pathname === '/api/status') return json(200, {
          uptime: 125, current_cpu: 7, current_memory: missingMemory ? null : 22,
          cpu_history: [], memory_history: [], audit_logs: [], healing_state: {},
          health_score: missingMemory ? null : { overall: 98, grade: 'A', status: 'Healthy' }, maintenance_mode: false,
          store_metrics: storeMetrics,
        })
        if (url.origin === cloudApiOrigin && url.pathname === '/api/maintenance') return json(200, { maintenance: true })
        if (url.origin === storeApiOrigin && url.pathname === '/api/products') return json(200, { products: [] })
        if (url.origin === storeApiOrigin && ['/api/orders/me', '/api/admin/orders'].includes(url.pathname)) return json(200, { orders: [] })
        if (url.origin === storeApiOrigin && url.pathname === '/api/admin/session') return json(200, { role: 'store-admin' })
        unexpected.push(`${request.method()} ${url.href}`)
        return request.abort()
      }
      // Block decorative third-party resources too, so the suite is isolated.
      if (!['fonts.googleapis.com', 'fonts.gstatic.com', 'images.unsplash.com'].includes(url.hostname)) unexpected.push(`${request.method()} ${url.href}`)
      return request.abort()
    })().catch((error) => errors.push(error.message))
  })
  return {
    page, calls, errors, unexpected, authorizations,
    denyPath: (route, status = 403) => deniedPaths.set(route, status),
    releaseSession: async () => { holdApproval = false; await Promise.all(held.splice(0).map((respond) => respond())) },
    close: async () => { await context.close().catch(() => undefined) },
  }
}

const cloudDataCalls = (calls) => calls.filter((call) => ['/api/status', '/api/maintenance'].includes(call.path))

async function checkCloudOpsGate(browser, { name, user, expected, ...options }) {
  const test = await newPage(browser, { user, ...options })
  try {
    await test.page.goto(`${cloudOpsOrigin}/`, { waitUntil: 'networkidle2' })
    await test.page.waitForFunction((text) => document.body.innerText.toLowerCase().includes(text.toLowerCase()), {}, expected)
    assert.equal(await test.page.$('.bento-grid'), null, `${name}: infrastructure metrics must stay hidden`)
    assert.equal(cloudDataCalls(test.calls).length, 0, `${name}: metrics and controls must not make requests`)
    if (options.noSessionRequest) assert.equal(test.calls.length, 0, `${name}: no API requests are allowed before a local administrator claim`)
    assert.deepEqual(test.errors, [], `${name}: browser errors`)
    assert.deepEqual(test.unexpected, [], `${name}: unexpected external requests`)
    console.log(`PASS: ${name}`)
  } finally { await test.close() }
}

async function checkApprovedCloudOps(browser) {
  const user = fixtureUser({ groups: ['store-admin'] })
  const test = await newPage(browser, { user, holdSession: true })
  try {
    await test.page.goto(`${cloudOpsOrigin}/`, { waitUntil: 'domcontentloaded' })
    await test.page.waitForFunction(() => /verif|checking/i.test(document.body.innerText))
    for (let attempt = 0; !test.calls.some((call) => call.path === '/api/session') && attempt < 200; attempt++) await pause(20)
    assert(test.calls.some((call) => call.path === '/api/session'), 'administrator server approval must be requested')
    assert.equal(cloudDataCalls(test.calls).length, 0, 'metrics must wait for server approval')
    assert.equal(await test.page.$('.bento-grid'), null, 'dashboard must wait for server approval')
    await test.releaseSession()
    await test.page.waitForSelector('.bento-grid')
    await test.page.waitForFunction(() => document.body.innerText.includes('Grade A'))
    const darkText = await test.page.evaluate(() => ({
      value: getComputedStyle(document.querySelector('.status-value')).color,
      protection: getComputedStyle([...document.querySelectorAll('span')].find((span) => span.textContent === 'SSM Remediation (Software)')).color,
    }))
    assert.deepEqual(darkText, { value: 'rgb(248, 250, 252)', protection: 'rgb(248, 250, 252)' }, 'dark dashboard values and protections must be readable')
    assert((await test.page.evaluate(() => document.body.innerText)).includes('No incidents recorded in the last 24 hours.'), 'empty incident history must explain the time window')
    for (let attempt = 0; cloudDataCalls(test.calls).length < 2 && attempt < 100; attempt++) await pause(20)
    assert(cloudDataCalls(test.calls).length >= 2, 'approved administrator must receive repeated metric polls')
    await test.page.$$eval('button', (buttons) => buttons.find((button) => /Maintenance OFF/.test(button.textContent))?.click())
    for (let attempt = 0; !test.calls.some((call) => call.path === '/api/maintenance') && attempt < 100; attempt++) await pause(20)
    assert(test.calls.some((call) => call.path === '/api/maintenance'), 'approved administrator can use maintenance control')
    assert(test.calls.every((call) => call.authorization === `Bearer ${user.access_token}`), 'all CloudOps API calls must carry the access token')
    await test.page.click('button[title="Sign Out"]')
    await test.page.waitForFunction(() => document.body.innerText.includes('Authentication Required'))
    assert.equal(await test.page.$('.bento-grid'), null, 'sign-out immediately hides metrics')
    const afterSignout = cloudDataCalls(test.calls).length
    await pause(400)
    assert.equal(cloudDataCalls(test.calls).length, afterSignout, 'sign-out stops metric polling')
    assert.deepEqual(test.errors, [])
    assert.deepEqual(test.unexpected, [])
    console.log('PASS: approved admin waits for server approval, uses authenticated controls, and sign-out hides data and stops polling')
  } finally { await test.close() }
}

async function checkApplicationMetrics(browser) {
  for (const status of ['available', 'partial', 'stale', 'no_data', 'error', 'idle']) {
    const data = { status: status === 'idle' ? 'available' : status, request_count: status === 'idle' ? 0 : 120,
      requests_per_minute: status === 'idle' ? 0 : 24, average_response_ms: status === 'idle' ? null : 37.5,
      client_errors: 2, server_errors: 3, server_error_percent: 2.5, observed_seconds: 300,
      last_sample: new Date().toISOString(), instance_id: 'i-browser-fixture' }
    const test = await newPage(browser, { user: fixtureUser({ groups: ['store-admin'] }), storeMetrics: data })
    try {
      await test.page.goto(`${cloudOpsOrigin}/`, { waitUntil: 'networkidle2' })
      const section = await test.page.waitForSelector('section[aria-label="Store API monitoring"]')
      await test.page.waitForFunction(() => document.body.innerText.includes('Grade A'))
      const values = await section.$$eval('.status-value', nodes => nodes.map(n => n.textContent))
      if (['stale', 'no_data', 'error'].includes(status)) assert(values.every(v => v === '—'), `${status} data must not look live`)
      else if (status === 'idle') assert.deepEqual(values.slice(0, 3), ['0', '0', '—'], 'confirmed idle traffic is zero; latency stays unavailable')
      else assert.deepEqual(values, ['120', '24', '37.5 ms', '3', '2'])
      if (status === 'partial') assert((await section.evaluate(n => n.innerText)).includes('Partial collection window'))
      assert.deepEqual(test.errors, [])
      console.log(`PASS: Store API monitoring ${status}`)
    } finally { await test.close() }
  }
}

async function checkRevokedCloudOps(browser, route) {
  const test = await newPage(browser, { user: fixtureUser({ groups: ['store-admin'] }) })
  try {
    await test.page.goto(`${cloudOpsOrigin}/`, { waitUntil: 'domcontentloaded' })
    await test.page.waitForSelector('.bento-grid')
    await test.page.waitForFunction(() => document.body.innerText.includes('Grade A'))
    test.denyPath(route)
    if (route === '/api/maintenance') {
      await test.page.$$eval('button', (buttons) => buttons.find((button) => /Maintenance OFF/.test(button.textContent))?.click())
    }
    await test.page.waitForFunction(() => document.body.innerText.includes('Administrator access required'))
    assert(test.calls.some((call) => call.path === route), 'the revoked endpoint must have been requested')
    assert.equal(await test.page.$('.bento-grid'), null, 'server revocation hides previously loaded metrics')
    const afterDenial = cloudDataCalls(test.calls).length
    await pause(400)
    assert.equal(cloudDataCalls(test.calls).length, afterDenial, 'server revocation stops subsequent metric and control requests')
    assert.deepEqual(test.errors, [])
    assert.deepEqual(test.unexpected, [])
    console.log(`PASS: ${route} denial revokes an approved session, hides data and stops polling`)
  } finally { await test.close() }
}

async function checkMissingMemoryCloudOps(browser) {
  const test = await newPage(browser, { user: fixtureUser({ groups: ['store-admin'] }), missingMemory: true })
  try {
    await test.page.goto(`${cloudOpsOrigin}/`, { waitUntil: 'domcontentloaded' })
    await test.page.waitForSelector('.bento-grid')
    await test.page.$$eval('button', (buttons) => buttons.find((button) => button.textContent === 'Memory')?.click())
    await test.page.waitForFunction(() => document.body.innerText.includes('NO DATA'))
    assert((await test.page.evaluate(() => document.body.innerText)).includes('Waiting for CPU and memory data'))
    assert.deepEqual(test.errors, [])
    console.log('PASS: missing memory samples are shown as unavailable')
  } finally { await test.close() }
}

async function checkStorefrontLinks(browser, { name, user, admin }) {
  for (const mobile of [false, true]) {
    const test = await newPage(browser, { user, mobile })
    try {
      await test.page.goto(`${storefrontOrigin}/`, { waitUntil: 'networkidle2' })
      if (user && user.expires_at > Date.now() / 1000) await test.page.waitForSelector('.store-user')
      if (mobile) await test.page.click('button[aria-label="Toggle menu"]')
      const navLinks = await test.page.$$eval('.store-nav a', (anchors) => anchors.filter((anchor) => anchor.textContent.includes('CloudOps')).map((anchor) => ({ href: anchor.href, visible: anchor.getClientRects().length > 0 })))
      const footerLinks = await test.page.$$eval('.store-footer a', (anchors) => anchors.filter((anchor) => anchor.textContent.includes('CloudOps')).map((anchor) => anchor.href))
      assert.equal(navLinks.length, admin ? 1 : 0, `${name}: ${mobile ? 'mobile' : 'desktop'} CloudOps navigation visibility`)
      assert.equal(footerLinks.length, admin ? 1 : 0, `${name}: CloudOps footer visibility`)
      if (admin) {
        assert(navLinks[0].visible)
        assert.equal(navLinks[0].href, `${cloudOpsOrigin}/?sso=storefront`)
        assert.equal(footerLinks[0], navLinks[0].href)
      }
      for (const route of ['/account/orders', '/admin/orders']) {
        await test.page.goto(`${storefrontOrigin}${route}`, { waitUntil: 'networkidle2' })
        await test.page.waitForSelector('.store-portal-header')
        const portalLinks = await test.page.$$eval('.store-portal-header a', (anchors) => anchors.filter((anchor) => anchor.textContent.includes('CloudOps')).map((anchor) => anchor.href))
        assert.equal(portalLinks.length, admin ? 1 : 0, `${name}: ${route} CloudOps visibility`)
        if (admin) assert.equal(portalLinks[0], `${cloudOpsOrigin}/?sso=storefront`)
      }
      assert.deepEqual(test.errors, [], `${name}: browser errors`)
      assert.deepEqual(test.unexpected, [], `${name}: unexpected external requests`)
      console.log(`PASS: ${name} storefront ${mobile ? 'mobile' : 'desktop'} navigation, footer and order-page CloudOps links`)
    } finally { await test.close() }
  }
}

async function checkStorefrontSso(browser, { name, outcome = 'admin', oldCustomerSession = false, rejectedByServer = false }) {
  const user = fixtureUser({ groups: oldCustomerSession || outcome === 'customer' ? [] : ['store-admin'] })
  const test = await newPage(browser, {
    user, seedStorefrontOnly: !oldCustomerSession, ssoOutcome: outcome,
    holdSession: outcome === 'admin' && !rejectedByServer,
    sessionStatus: rejectedByServer ? 403 : 200,
  })
  try {
    let destination = `${cloudOpsOrigin}/?sso=storefront`
    if (!oldCustomerSession) {
      await test.page.goto(`${storefrontOrigin}/`, { waitUntil: 'networkidle2' })
      if (outcome === 'customer') assert.equal(await test.page.$('.store-nav-dashboard'), null)
      else destination = await test.page.$eval('.store-nav-dashboard', (anchor) => anchor.href)
    }
    const navigation = new URL(destination)
    assert.deepEqual([...navigation.searchParams.keys()], ['sso'], 'SSO links must not contain tokens or credentials')
    await test.page.goto(destination, { waitUntil: 'networkidle2' })

    if (outcome === 'expired') {
      await test.page.waitForFunction(() => document.body.innerText.includes('Your administrator session could not be continued'))
      const retryLink = await test.page.$eval('a', (anchor) => anchor.href)
      assert.equal(retryLink, `${storefrontOrigin}/admin/orders`)
      assert.equal(cloudDataCalls(test.calls).length, 0)
      const attempts = test.authorizations.length
      await pause(300)
      assert.equal(test.authorizations.length, attempts, 'expired SSO must not redirect in a loop')
    } else if (outcome === 'customer' || rejectedByServer) {
      await test.page.waitForFunction(() => document.body.innerText.includes('Administrator access required'))
      assert.equal(cloudDataCalls(test.calls).length, 0)
      assert.equal(await test.page.$('.bento-grid'), null)
      if (outcome === 'customer') assert.equal(test.calls.filter((call) => call.path === '/api/session').length, 0)
    } else {
      await test.page.waitForFunction(() => document.body.innerText.includes('Verifying administrator access'))
      for (let attempt = 0; !test.calls.some((call) => call.path === '/api/session') && attempt < 200; attempt++) await pause(20)
      assert(test.calls.some((call) => call.path === '/api/session'))
      assert.equal(cloudDataCalls(test.calls).length, 0, 'SSO must still wait for server authorization')
      await test.releaseSession()
      await test.page.waitForSelector('.bento-grid')
      await test.page.waitForFunction(() => document.body.innerText.includes('Grade A'))
      assert(test.calls.some((call) => call.path === '/api/status'))
      assert(test.calls.filter((call) => call.path === '/api/status').every((call) => call.authorization && call.authorization !== `Bearer ${user.access_token}`), 'CloudOps must use its own newly issued token')
    }

    assert.equal(test.authorizations.length, 1, 'one automatic SSO authorization per entry')
    assert.deepEqual(test.authorizations[0], { prompt: 'none', responseType: 'code', challengeMethod: 'S256' })
    assert.deepEqual(test.errors, [])
    assert.deepEqual(test.unexpected, [])
    console.log(`PASS: ${name}`)
  } finally { await test.close() }
}

async function run() {
  const servers = []
  let browser
  try {
    servers.push(await startVite('cloudops', 5180))
    servers.push(await startVite('storefront', 5181))
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ].find((candidate) => existsSync(candidate))
    browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
    for (const scenario of [
      { name: 'anonymous direct CloudOps URL is locked', user: null, expected: 'Authentication Required', noSessionRequest: true },
      { name: 'customer direct CloudOps URL is locked', user: fixtureUser(), expected: 'Administrator access required', noSessionRequest: true },
      { name: 'lookalike group does not grant CloudOps access', user: fixtureUser({ groups: ['store-admins', 'prefix-store-admin'] }), expected: 'Administrator access required', noSessionRequest: true },
      { name: 'ID-token-only admin group does not grant CloudOps access', user: fixtureUser({ idGroups: ['store-admin'] }), expected: 'Administrator access required', noSessionRequest: true },
      { name: 'missing access token fails closed', user: fixtureUser({ idGroups: ['store-admin'], missingToken: true }), expected: 'Administrator access required', noSessionRequest: true },
      { name: 'malformed access token fails closed', user: fixtureUser({ idGroups: ['store-admin'], malformedToken: true }), expected: 'Administrator access required', noSessionRequest: true },
      { name: 'expired administrator session is locked', user: fixtureUser({ groups: ['store-admin'], expired: true }), expected: 'Authentication Required', noSessionRequest: true },
      { name: 'server denial overrides browser admin group', user: fixtureUser({ groups: ['store-admin'] }), expected: 'Administrator access required', sessionStatus: 403, sessionBody: { error: { code: 'FORBIDDEN' } } },
      { name: 'unavailable approval API fails closed', user: fixtureUser({ groups: ['store-admin'] }), expected: 'Administrator access could not be verified', sessionStatus: 503, sessionBody: { error: { code: 'UNAVAILABLE' } } },
      { name: 'approval network failure fails closed', user: fixtureUser({ groups: ['store-admin'] }), expected: 'Administrator access could not be verified', networkFailure: true },
      { name: 'successful response without approved admin role fails closed', user: fixtureUser({ groups: ['store-admin'] }), expected: 'Administrator access could not be verified', sessionBody: { role: 'customer' } },
    ]) await checkCloudOpsGate(browser, scenario)
    await checkApprovedCloudOps(browser)
    await checkApplicationMetrics(browser)
    await checkMissingMemoryCloudOps(browser)
    await checkRevokedCloudOps(browser, '/api/status')
    await checkRevokedCloudOps(browser, '/api/maintenance')
    for (const scenario of [
      { name: 'anonymous', user: null, admin: false },
      { name: 'customer', user: fixtureUser(), admin: false },
      { name: 'lookalike-group customer', user: fixtureUser({ groups: ['store-admins'] }), admin: false },
      { name: 'ID-token-only administrator claim', user: fixtureUser({ idGroups: ['store-admin'] }), admin: false },
      { name: 'administrator', user: fixtureUser({ groups: ['store-admin'] }), admin: true },
    ]) await checkStorefrontLinks(browser, scenario)
    for (const scenario of [
      { name: 'Storefront admin opens CloudOps through no-prompt SSO with PKCE and server authorization' },
      { name: 'SSO replaces an old customer dashboard session with the current administrator identity', oldCustomerSession: true },
      { name: 'customer cannot gain access through a forged SSO navigation marker', outcome: 'customer' },
      { name: 'expired managed-login session returns to Storefront without a second credential form or loop', outcome: 'expired' },
      { name: 'server denial still blocks an SSO-authenticated administrator', rejectedByServer: true },
    ]) await checkStorefrontSso(browser, scenario)
    console.log('CloudOps browser access regression checks passed. All external identity/API traffic was mocked; no AWS changes were made.')
  } finally {
    if (browser) await browser.close().catch(() => undefined)
    for (const server of servers) server.kill()
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
