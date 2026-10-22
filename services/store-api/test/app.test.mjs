import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createStoreApi } from '../src/app.mjs'
import { createCognitoAccessTokenVerifier } from '../src/auth.mjs'
import { MemoryStore, seedProducts } from '../src/memory-store.mjs'

const servers = new Set()
const allowedOrigin = 'http://127.0.0.1:5173'
const testPrincipals = new Map([
  ['customer-a-token', { sub: 'customer-a' }],
  ['customer-b-token', { sub: 'customer-b' }],
  ['admin-token', { sub: 'store-admin-user', 'cognito:groups': ['store-admin'] }],
  ['admin-string-group-token', { sub: 'store-admin-user-2', 'cognito:groups': 'store-admin' }],
  ['other-group-token', { sub: 'other-user', 'cognito:groups': ['store-admins'] }],
  ['fake-role-token', { sub: 'other-user', role: 'store-admin', email: 'admin@example.test' }],
])

async function withServer(run, { repository = new MemoryStore(), verifyAccessToken = async (token) => {
  const principal = testPrincipals.get(token)
  if (!principal) throw new Error('Invalid test token')
  return principal
}, recognizeChatMessage } = {}) {
  const server = createStoreApi({
    repository,
    allowedOrigins: [allowedOrigin],
    verifyAccessToken,
    recognizeChatMessage,
    logger: { error() {} },
  })
  servers.add(server)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = 'http://127.0.0.1:' + address.port
  try {
    return await run(baseUrl, repository)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    servers.delete(server)
  }
}

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => server.close(resolve))))
  servers.clear()
})

function authorization(token = 'customer-a-token') {
  return { Authorization: `Bearer ${token}` }
}

function requestOrder(baseUrl, { token = 'customer-a-token', key, items, shippingAddress = completeAddress(), extra = {} }) {
  return fetch(baseUrl + '/api/orders', {
    method: 'POST',
    headers: {
      ...authorization(token),
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify({ items, ...(shippingAddress ? { shippingAddress } : {}), ...extra }),
  })
}

function completeAddress(overrides = {}) {
  return {
    recipientName: 'Taylor Customer',
    addressLine1: '12 Market Street',
    locality: 'Springfield',
    region: 'CA',
    postalCode: '90210',
    countryCode: 'us',
    ...overrides,
  }
}

test('Cognito verifier stays disabled until an owner supplies a pool and public app-client ID', () => {
  assert.equal(createCognitoAccessTokenVerifier({}), null)
  assert.equal(createCognitoAccessTokenVerifier({ userPoolId: 'us-east-1_example' }), null)
  assert.equal(typeof createCognitoAccessTokenVerifier({
    userPoolId: 'us-east-1_example',
    clientId: 'public-storefront-client',
  }), 'function')
})

test('health and catalog routes return safe public data', async () => {
  await withServer(async (baseUrl) => {
    const health = await fetch(baseUrl + '/health')
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: 'ok' })

    const response = await fetch(baseUrl + '/api/products')
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.products.length, 6)
    assert.equal(body.products[0].priceCents, 6800)
    assert.equal(body.products[0].inStock, true)
    assert.equal(Object.hasOwn(body.products[0], 'stock'), false)
  })
})

test('storefront chat validates input and returns Lex text messages without authentication', async () => {
  const calls = []
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl + '/api/chat', {
      method: 'POST',
      headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Where are my orders?', sessionId: 'session-123' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { messages: ['Sign in and open My Orders.'] })
    assert.deepEqual(calls, [{ message: 'Where are my orders?', sessionId: 'session-123' }])

    const tooLong = await fetch(baseUrl + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'x'.repeat(401), sessionId: 'session-123' }),
    })
    assert.equal(tooLong.status, 400)
    assert.equal((await tooLong.json()).error.code, 'INVALID_CHAT_MESSAGE')

    const extraField = await fetch(baseUrl + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello', sessionId: 'session-123', token: 'should-not-be-accepted' }),
    })
    assert.equal(extraField.status, 400)
    assert.equal((await extraField.json()).error.code, 'INVALID_CHAT_REQUEST')
  }, {
    recognizeChatMessage: async (input) => {
      calls.push(input)
      return ['Sign in and open My Orders.']
    },
  })
})

test('storefront chat fails with a clear service error when Lex is not configured', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello', sessionId: 'session-123' }),
    })
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, 'CHAT_NOT_CONFIGURED')
  })
})

test('protected routes require a valid access token and fail closed when Cognito is not configured', async () => {
  await withServer(async (baseUrl) => {
    const noToken = await fetch(baseUrl + '/api/orders/me')
    assert.equal(noToken.status, 401)
    assert.equal((await noToken.json()).error.code, 'UNAUTHORIZED')

    const badToken = await fetch(baseUrl + '/api/orders/me', { headers: authorization('forged-token') })
    assert.equal(badToken.status, 401)
  })

  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl + '/api/orders/me')
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, 'AUTH_NOT_CONFIGURED')
  }, { verifyAccessToken: null })
})

test('admin sign-in verification permits only the exact verified store-admin group', async () => {
  await withServer(async (baseUrl) => {
    const anonymous = await fetch(baseUrl + '/api/admin/session')
    assert.equal(anonymous.status, 401)

    const forged = await fetch(baseUrl + '/api/admin/session', { headers: authorization('forged-token') })
    assert.equal(forged.status, 401)

    for (const token of ['customer-a-token', 'customer-b-token', 'other-group-token', 'fake-role-token']) {
      const rejected = await fetch(baseUrl + '/api/admin/session', { headers: authorization(token) })
      assert.equal(rejected.status, 403, `${token} must not sign in as admin`)
      assert.equal((await rejected.json()).error.code, 'FORBIDDEN')
    }

    for (const token of ['admin-token', 'admin-string-group-token']) {
      const approved = await fetch(baseUrl + '/api/admin/session', { headers: authorization(token) })
      assert.equal(approved.status, 200)
      assert.deepEqual(await approved.json(), { role: 'store-admin' })
    }
  }, { repository: {} })
})

test('admin sign-in verification fails closed without configured Cognito verification', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl + '/api/admin/session', { headers: authorization('admin-token') })
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, 'AUTH_NOT_CONFIGURED')
  }, { verifyAccessToken: null })
})

test('order requests snapshot server prices, remain REQUESTED, and do not decrement stock', async () => {
  await withServer(async (baseUrl, repository) => {
    const initialStock = repository.products.get('orbit-desk-lamp').stock
    const key = 'b7414f48-5c03-4a22-9846-00c922a9b0f1'
    const first = await requestOrder(baseUrl, {
      key,
      items: [{ productId: 'orbit-desk-lamp', quantity: 2 }],
      shippingAddress: completeAddress(),
    })
    const firstBody = await first.json()
    assert.equal(first.status, 201)
    assert.equal(firstBody.order.totalCents, 13600)
    assert.equal(firstBody.order.items[0].unitPriceCents, 6800)
    assert.equal(firstBody.order.status, 'REQUESTED')
    assert.equal(Object.hasOwn(firstBody.order, 'customerSub'), false)
    assert.equal(repository.products.get('orbit-desk-lamp').stock, initialStock)

    const retry = await requestOrder(baseUrl, {
      key,
      items: [{ productId: 'orbit-desk-lamp', quantity: 2 }],
      shippingAddress: completeAddress(),
    })
    const retryBody = await retry.json()
    assert.equal(retry.status, 200)
    assert.equal(retryBody.order.id, firstBody.order.id)

    const sameKeyOtherCustomer = await requestOrder(baseUrl, {
      token: 'customer-b-token',
      key,
      items: [{ productId: 'orbit-desk-lamp', quantity: 1 }],
    })
    assert.equal(sameKeyOtherCustomer.status, 201)
    assert.notEqual((await sameKeyOtherCustomer.json()).order.id, firstBody.order.id)
    assert.equal(repository.products.get('orbit-desk-lamp').stock, initialStock)
  })
})

test('order request requires a complete shipping address', async () => {
  await withServer(async (baseUrl) => {
    const key = 'b7414f48-5c03-4a22-9846-00c922a9b0f8'
    for (const shippingAddress of [undefined, {}, completeAddress({ postalCode: ' ' })]) {
      const response = await fetch(baseUrl + '/api/orders', {
        method: 'POST',
        headers: { ...authorization(), 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ items: [{ productId: 'orbit-desk-lamp', quantity: 1 }], ...(shippingAddress === undefined ? {} : { shippingAddress }) }),
      })
      assert.equal(response.status, 400)
      assert.equal((await response.json()).error.code, 'SHIPPING_ADDRESS_REQUIRED')
    }
  })
})

test('order creation rejects forged identity, prices, invalid items, and payment fields', async () => {
  await withServer(async (baseUrl) => {
    const key = 'b7414f48-5c03-4a22-9846-00c922a9b0f2'
    const send = (body, idempotencyKey = key) => fetch(baseUrl + '/api/orders', {
      method: 'POST',
      headers: { ...authorization(), 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    })

    assert.equal((await send({ items: [{ productId: 'orbit-desk-lamp', quantity: 1 }] }, '')).status, 400)
    assert.equal((await send({ items: [{ productId: 'orbit-desk-lamp', quantity: 1, price: 0 }] })).status, 400)
    assert.equal((await send({ items: [{ productId: 'orbit-desk-lamp', quantity: 11 }] })).status, 400)
    assert.equal((await send({ items: [{ productId: 'missing-product', quantity: 1 }], shippingAddress: completeAddress() })).status, 404)
    assert.equal((await send({ items: [{ productId: 'orbit-desk-lamp', quantity: 1 }], customerSub: 'customer-b' })).status, 400)
    assert.equal((await send({ items: [{ productId: 'orbit-desk-lamp', quantity: 1 }], paymentToken: 'must-not-be-accepted' })).status, 400)
    assert.equal((await send({ items: [{ productId: 'orbit-desk-lamp', quantity: 1 }], shippingAddress: { unknown: 'field' } })).status, 400)
  })
})

test('customers can view and cancel only their own REQUESTED orders', async () => {
  await withServer(async (baseUrl) => {
    const key = 'b7414f48-5c03-4a22-9846-00c922a9b0f3'
    const created = await requestOrder(baseUrl, {
      key,
      items: [{ productId: 'orbit-desk-lamp', quantity: 1 }],
    })
    const order = (await created.json()).order

    const ownOrders = await fetch(baseUrl + '/api/orders/me', { headers: authorization() })
    assert.equal((await ownOrders.json()).orders.length, 1)
    const otherOrders = await fetch(baseUrl + '/api/orders/me', { headers: authorization('customer-b-token') })
    assert.deepEqual((await otherOrders.json()).orders, [])

    const otherCancel = await fetch(baseUrl + `/api/orders/${order.id}/cancel`, {
      method: 'POST',
      headers: authorization('customer-b-token'),
    })
    assert.equal(otherCancel.status, 404)

    const customerEdit = await fetch(baseUrl + `/api/orders/${order.id}`, {
      method: 'PATCH',
      headers: { ...authorization(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ shippingAddress: completeAddress() }),
    })
    assert.equal(customerEdit.status, 404)

    const cancel = await fetch(baseUrl + `/api/orders/${order.id}/cancel`, {
      method: 'POST',
      headers: authorization(),
    })
    assert.equal(cancel.status, 200)
    assert.equal((await cancel.json()).order.status, 'CANCELLED')

    const retryCancel = await fetch(baseUrl + `/api/orders/${order.id}/cancel`, {
      method: 'POST',
      headers: authorization(),
    })
    assert.equal(retryCancel.status, 200)
    assert.equal((await retryCancel.json()).order.status, 'CANCELLED')
  })
})

test('only admins can manage pending orders and acceptance decrements stock once', async () => {
  await withServer(async (baseUrl, repository) => {
    const initialStock = repository.products.get('orbit-desk-lamp').stock
    const created = await requestOrder(baseUrl, {
      key: 'b7414f48-5c03-4a22-9846-00c922a9b0f4',
      items: [{ productId: 'orbit-desk-lamp', quantity: 1 }],
    })
    const order = (await created.json()).order

    const customerAdminList = await fetch(baseUrl + '/api/admin/orders', { headers: authorization() })
    assert.equal(customerAdminList.status, 403)

    const customerAdminUpdate = await fetch(baseUrl + `/api/admin/orders/${order.id}`, {
      method: 'PATCH',
      headers: { ...authorization(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ shippingAddress: completeAddress() }),
    })
    assert.equal(customerAdminUpdate.status, 403)

    const customerAdminAccept = await fetch(baseUrl + `/api/admin/orders/${order.id}/accept`, {
      method: 'POST',
      headers: authorization(),
    })
    assert.equal(customerAdminAccept.status, 403)

    const addressUpdate = await fetch(baseUrl + `/api/admin/orders/${order.id}`, {
      method: 'PATCH',
      headers: { ...authorization('admin-token'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ shippingAddress: completeAddress({ locality: 'Changed City' }) }),
    })
    assert.equal(addressUpdate.status, 400)
    assert.equal((await addressUpdate.json()).error.code, 'INVALID_ORDER_UPDATE')

    const itemUpdate = await fetch(baseUrl + `/api/admin/orders/${order.id}`, {
      method: 'PATCH',
      headers: { ...authorization('admin-token'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ productId: 'orbit-desk-lamp', quantity: 1 }] }),
    })
    assert.equal(itemUpdate.status, 200)
    assert.equal((await itemUpdate.json()).order.shippingAddress.locality, 'Springfield')

    const accepted = await fetch(baseUrl + `/api/admin/orders/${order.id}/accept`, {
      method: 'POST',
      headers: authorization('admin-string-group-token'),
    })
    assert.equal(accepted.status, 200)
    const acceptedBody = await accepted.json()
    assert.equal(acceptedBody.accepted, true)
    assert.equal(acceptedBody.order.status, 'ACCEPTED')
    assert.equal(repository.products.get('orbit-desk-lamp').stock, initialStock - 1)

    const acceptRetry = await fetch(baseUrl + `/api/admin/orders/${order.id}/accept`, {
      method: 'POST',
      headers: authorization('admin-token'),
    })
    assert.equal((await acceptRetry.json()).accepted, false)
    assert.equal(repository.products.get('orbit-desk-lamp').stock, initialStock - 1)

    const customerCancel = await fetch(baseUrl + `/api/orders/${order.id}/cancel`, {
      method: 'POST',
      headers: authorization(),
    })
    assert.equal(customerCancel.status, 409)

    const editAccepted = await fetch(baseUrl + `/api/admin/orders/${order.id}`, {
      method: 'PATCH',
      headers: { ...authorization('admin-token'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ productId: 'orbit-desk-lamp', quantity: 1 }] }),
    })
    assert.equal(editAccepted.status, 409)
  })
})

test('admin rejection requires a reason and is visible to the customer without changing stock', async () => {
  await withServer(async (baseUrl, repository) => {
    const initialStock = repository.products.get('orbit-desk-lamp').stock
    const created = await requestOrder(baseUrl, {
      key: 'b7414f48-5c03-4a22-9846-00c922a9b0f9',
      items: [{ productId: 'orbit-desk-lamp', quantity: 1 }],
    })
    const order = (await created.json()).order
    const url = `${baseUrl}/api/admin/orders/${order.id}/reject`
    const reject = (token, reason) => fetch(url, {
      method: 'POST',
      headers: { ...authorization(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    assert.equal((await reject('customer-a-token', 'Unavailable')).status, 403)
    const missingReason = await reject('admin-token', '   ')
    assert.equal(missingReason.status, 400)
    assert.equal((await missingReason.json()).error.code, 'REJECTION_REASON_REQUIRED')
    const rejected = await reject('admin-token', '  Item is no longer available.  ')
    assert.equal(rejected.status, 200)
    assert.equal((await rejected.json()).order.rejectionReason, 'Item is no longer available.')
    assert.equal(repository.products.get('orbit-desk-lamp').stock, initialStock)
    const ownOrders = await fetch(baseUrl + '/api/orders/me', { headers: authorization() })
    const customerOrder = (await ownOrders.json()).orders[0]
    assert.equal(customerOrder.status, 'REJECTED')
    assert.equal(customerOrder.rejectionReason, 'Item is no longer available.')
    assert.equal((await reject('admin-token', 'Different reason')).status, 409)
    assert.equal((await fetch(`${baseUrl}/api/admin/orders/${order.id}/accept`, { method: 'POST', headers: authorization('admin-token') })).status, 409)
  })
})

test('acceptance rechecks inventory so multiple requests cannot oversell stock', async () => {
  const oneStockProduct = { ...seedProducts[0], stock: 1 }
  const repository = new MemoryStore([oneStockProduct])
  await withServer(async (baseUrl) => {
    const makeOrder = (token, key) => requestOrder(baseUrl, {
      token,
      key,
      items: [{ productId: oneStockProduct.id, quantity: 1 }],
      shippingAddress: completeAddress(),
    })
    const first = await makeOrder('customer-a-token', 'b7414f48-5c03-4a22-9846-00c922a9b0f5')
    const second = await makeOrder('customer-b-token', 'b7414f48-5c03-4a22-9846-00c922a9b0f6')
    assert.equal(first.status, 201)
    assert.equal(second.status, 201)

    const firstId = (await first.json()).order.id
    const secondId = (await second.json()).order.id
    const acceptFirst = await fetch(baseUrl + `/api/admin/orders/${firstId}/accept`, {
      method: 'POST',
      headers: authorization('admin-token'),
    })
    assert.equal(acceptFirst.status, 200)

    const acceptSecond = await fetch(baseUrl + `/api/admin/orders/${secondId}/accept`, {
      method: 'POST',
      headers: authorization('admin-token'),
    })
    assert.equal(acceptSecond.status, 409)
    assert.equal((await acceptSecond.json()).error.code, 'INSUFFICIENT_STOCK')
    assert.equal(repository.products.get(oneStockProduct.id).stock, 0)
  }, { repository })
})

test('invalid JSON, non-JSON bodies, and disallowed origins fail safely', async () => {
  await withServer(async (baseUrl) => {
    const invalidJson = await fetch(baseUrl + '/api/orders', {
      method: 'POST',
      headers: {
        ...authorization(),
        'Content-Type': 'application/json',
        'Idempotency-Key': 'b7414f48-5c03-4a22-9846-00c922a9b0f7',
      },
      body: '{',
    })
    assert.equal(invalidJson.status, 400)
    assert.equal((await invalidJson.json()).error.code, 'INVALID_JSON')

    const nonJson = await fetch(baseUrl + '/api/orders', {
      method: 'POST',
      headers: { ...authorization(), 'Content-Type': 'text/plain' },
      body: 'not json',
    })
    assert.equal(nonJson.status, 415)

    const badOrigin = await fetch(baseUrl + '/api/products', { headers: { Origin: 'https://attacker.example' } })
    assert.equal(badOrigin.status, 403)
    assert.equal((await badOrigin.json()).error.code, 'ORIGIN_NOT_ALLOWED')

    const preflight = await fetch(baseUrl + '/api/orders', {
      method: 'OPTIONS',
      headers: { Origin: allowedOrigin, 'Access-Control-Request-Method': 'POST' },
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-origin'), allowedOrigin)
    assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/i)
    assert.match(preflight.headers.get('access-control-allow-methods'), /patch/i)
  })
})
