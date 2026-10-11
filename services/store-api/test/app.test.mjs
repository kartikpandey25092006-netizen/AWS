import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createStoreApi } from '../src/app.mjs'
import { MemoryStore } from '../src/memory-store.mjs'

const servers = new Set()
const allowedOrigin = 'http://127.0.0.1:5173'

async function withServer(run) {
  const server = createStoreApi({
    repository: new MemoryStore(),
    allowedOrigins: [allowedOrigin],
    logger: { error() {} },
  })
  servers.add(server)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = 'http://127.0.0.1:' + address.port
  try {
    return await run(baseUrl)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    servers.delete(server)
  }
}

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => server.close(resolve))))
  servers.clear()
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

test('order price is computed on the server and retry is idempotent', async () => {
  await withServer(async (baseUrl) => {
    const key = 'b7414f48-5c03-4a22-9846-00c922a9b0f1'
    const payload = { items: [{ productId: 'orbit-desk-lamp', quantity: 2 }] }
    const first = await fetch(baseUrl + '/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    })
    const firstBody = await first.json()
    assert.equal(first.status, 201)
    assert.equal(firstBody.order.totalCents, 13600)
    assert.equal(firstBody.order.items[0].unitPriceCents, 6800)
    assert.equal(firstBody.order.status, 'PLACED')

    const retry = await fetch(baseUrl + '/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    })
    const retryBody = await retry.json()
    assert.equal(retry.status, 200)
    assert.equal(retryBody.order.id, firstBody.order.id)
  })
})

test('checkout rejects missing idempotency key, forged prices, invalid quantities, and unknown products', async () => {
  await withServer(async (baseUrl) => {
    const send = (body, key = '') => fetch(baseUrl + '/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify(body),
    })
    const key = 'b7414f48-5c03-4a22-9846-00c922a9b0f2'
    assert.equal((await send({ items: [{ productId: 'orbit-desk-lamp', quantity: 1 }] })).status, 400)
    assert.equal((await send({ items: [{ productId: 'orbit-desk-lamp', quantity: 1, price: 0 }] }, key)).status, 400)
    assert.equal((await send({ items: [{ productId: 'orbit-desk-lamp', quantity: 11 }] }, key)).status, 400)
    assert.equal((await send({ items: [{ productId: 'missing-product', quantity: 1 }] }, key)).status, 404)
  })
})

test('invalid JSON, non-JSON bodies, and disallowed origins fail safely', async () => {
  await withServer(async (baseUrl) => {
    const invalidJson = await fetch(baseUrl + '/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'b7414f48-5c03-4a22-9846-00c922a9b0f3' },
      body: '{',
    })
    assert.equal(invalidJson.status, 400)
    assert.equal((await invalidJson.json()).error.code, 'INVALID_JSON')

    const badOrigin = await fetch(baseUrl + '/api/products', { headers: { Origin: 'https://attacker.example' } })
    assert.equal(badOrigin.status, 403)
    assert.equal((await badOrigin.json()).error.code, 'ORIGIN_NOT_ALLOWED')

    const preflight = await fetch(baseUrl + '/api/orders', {
      method: 'OPTIONS',
      headers: { Origin: allowedOrigin, 'Access-Control-Request-Method': 'POST' },
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-origin'), allowedOrigin)
  })
})
