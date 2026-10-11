import { createServer } from 'node:http'
import { StoreError } from './memory-store.mjs'

const MAX_BODY_BYTES = 32 * 1024
const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': status === 200 ? 'no-store' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  response.end(JSON.stringify(body))
}

function allowCors(request, response, allowedOrigins) {
  const origin = request.headers.origin
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key')
    response.setHeader('Access-Control-Max-Age', '300')
    return true
  }
  return !origin
}

async function readJson(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new StoreError(413, 'BODY_TOO_LARGE', 'Request body is too large.')
    chunks.push(chunk)
  }
  if (size === 0) throw new StoreError(400, 'INVALID_JSON', 'A JSON request body is required.')
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new StoreError(400, 'INVALID_JSON', 'Request body must be valid JSON.')
  }
}

function validateOrder(body, idempotencyKey) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey || '')) {
    throw new StoreError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a valid Idempotency-Key UUID.')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'items')) {
    throw new StoreError(400, 'INVALID_ORDER', 'Order body must contain only an items list.')
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
    throw new StoreError(400, 'INVALID_ITEMS', 'Order must contain between 1 and 20 items.')
  }

  const seen = new Set()
  const items = body.items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).some((key) => key !== 'productId' && key !== 'quantity')) {
      throw new StoreError(400, 'INVALID_ITEM', 'Each item must contain only productId and quantity.')
    }
    const { productId, quantity } = item
    if (typeof productId !== 'string' || !PRODUCT_ID_PATTERN.test(productId)) {
      throw new StoreError(400, 'INVALID_PRODUCT_ID', 'Product ID is invalid.')
    }
    if (seen.has(productId)) throw new StoreError(400, 'DUPLICATE_PRODUCT', 'Combine quantities for each product.')
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      throw new StoreError(400, 'INVALID_QUANTITY', 'Quantity must be a whole number from 1 to 10.')
    }
    seen.add(productId)
    return { productId, quantity }
  })
  return { items, idempotencyKey }
}

export function createStoreApi({ repository, allowedOrigins = [], logger = console }) {
  const origins = new Set(allowedOrigins)

  return createServer(async (request, response) => {
    const corsAllowed = allowCors(request, response, origins)
    if (!corsAllowed) {
      sendJson(response, 403, { error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not allowed.' } })
      return
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    let url
    try {
      url = new URL(request.url || '/', 'http://localhost')
    } catch {
      sendJson(response, 400, { error: { code: 'INVALID_URL', message: 'Request URL is invalid.' } })
      return
    }

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { status: 'ok' })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/products') {
        const products = await repository.listProducts()
        sendJson(response, 200, { products })
        return
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/products/')) {
        let id
        try {
          id = decodeURIComponent(url.pathname.slice('/api/products/'.length))
        } catch {
          throw new StoreError(400, 'INVALID_PRODUCT_ID', 'Product ID is invalid.')
        }
        if (!PRODUCT_ID_PATTERN.test(id)) throw new StoreError(400, 'INVALID_PRODUCT_ID', 'Product ID is invalid.')
        const product = await repository.getProduct(id)
        if (!product) throw new StoreError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.')
        sendJson(response, 200, { product })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/orders') {
        if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
          throw new StoreError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.')
        }
        const { items, idempotencyKey } = validateOrder(
          await readJson(request),
          String(request.headers['idempotency-key'] || ''),
        )
        const result = await repository.createOrder(items, idempotencyKey)
        sendJson(response, result.created ? 201 : 200, { order: result.order })
        return
      }

      if (!['GET', 'POST', 'OPTIONS'].includes(request.method || '')) {
        response.setHeader('Allow', 'GET, POST, OPTIONS')
        throw new StoreError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed.')
      }
      throw new StoreError(404, 'NOT_FOUND', 'Route was not found.')
    } catch (error) {
      if (error instanceof StoreError) {
        sendJson(response, error.status, { error: { code: error.code, message: error.message } })
        return
      }
      logger.error('Store API request failed', { method: request.method, path: url.pathname, name: error?.name || 'Error' })
      sendJson(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } })
    }
  })
}
