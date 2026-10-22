import { createServer } from 'node:http'
import { StoreError } from './memory-store.mjs'

const MAX_BODY_BYTES = 32 * 1024
const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CHAT_SESSION_ID_PATTERN = /^[a-zA-Z0-9._:-]{2,100}$/
const CHAT_MESSAGE_MAX_LENGTH = 400
const ALLOWED_METHODS = 'GET, POST, PATCH, OPTIONS'
const ADDRESS_FIELDS = new Set([
  'recipientName',
  'addressLine1',
  'addressLine2',
  'locality',
  'region',
  'postalCode',
  'countryCode',
])
const ADDRESS_FIELD_MAX_LENGTH = {
  recipientName: 120,
  addressLine1: 200,
  addressLine2: 200,
  locality: 100,
  region: 100,
  postalCode: 24,
  countryCode: 2,
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
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
    response.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS)
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key')
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

function validateItems(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new StoreError(400, 'INVALID_ITEMS', 'Order must contain between 1 and 20 items.')
  }

  const seen = new Set()
  return value.map((item) => {
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
}

function validateShippingAddress(value) {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !ADDRESS_FIELDS.has(key))) {
    throw new StoreError(400, 'INVALID_ADDRESS', 'Shipping address contains invalid fields.')
  }

  const address = {}
  for (const [field, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== 'string') {
      throw new StoreError(400, 'INVALID_ADDRESS', 'Shipping address fields must be text.')
    }
    const text = rawValue.trim()
    if (text.length > ADDRESS_FIELD_MAX_LENGTH[field]) {
      throw new StoreError(400, 'INVALID_ADDRESS', 'A shipping address field is too long.')
    }
    if (field === 'countryCode' && text && !/^[a-z]{2}$/i.test(text)) {
      throw new StoreError(400, 'INVALID_ADDRESS', 'Country code must use two letters.')
    }
    address[field] = field === 'countryCode' ? text.toUpperCase() : text
  }
  return address
}

function validateOrder(body, idempotencyKey) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey || '')) {
    throw new StoreError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a valid Idempotency-Key UUID.')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'items' && key !== 'shippingAddress')) {
    throw new StoreError(400, 'INVALID_ORDER', 'Order body may contain only items and shippingAddress.')
  }
  const shippingAddress = validateShippingAddress(body.shippingAddress)
  if (!shippingAddress || !['recipientName', 'addressLine1', 'locality', 'postalCode', 'countryCode'].every((field) => shippingAddress[field])) {
    throw new StoreError(400, 'SHIPPING_ADDRESS_REQUIRED', 'Enter a complete shipping address before placing the order.')
  }
  return {
    items: validateItems(body.items),
    shippingAddress,
    idempotencyKey,
  }
}

function validateAdminOrderUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !Object.hasOwn(body, 'items')) {
    throw new StoreError(400, 'INVALID_ORDER_UPDATE', 'Admin updates may contain only items. Shipping address is set by the customer.')
  }
  return { items: validateItems(body.items) }
}

function validateChatRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'message' && key !== 'sessionId')) {
    throw new StoreError(400, 'INVALID_CHAT_REQUEST', 'Chat request must contain only a message and sessionId.')
  }
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.trim().length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new StoreError(400, 'INVALID_CHAT_MESSAGE', `Message must contain 1 to ${CHAT_MESSAGE_MAX_LENGTH} characters.`)
  }
  if (typeof body.sessionId !== 'string' || !CHAT_SESSION_ID_PATTERN.test(body.sessionId)) {
    throw new StoreError(400, 'INVALID_CHAT_SESSION', 'Chat session ID is invalid.')
  }
  return { message: body.message.trim(), sessionId: body.sessionId }
}

async function requirePrincipal(request, verifyAccessToken, logger) {
  if (!verifyAccessToken) {
    throw new StoreError(503, 'AUTH_NOT_CONFIGURED', 'Storefront authentication is not configured.')
  }

  const match = /^Bearer\s+(\S+)$/i.exec(String(request.headers.authorization || ''))
  if (!match) {
    logger.warn?.('Store API authorization header is missing or malformed.')
    throw new StoreError(401, 'UNAUTHORIZED', 'A valid access token is required.')
  }

  let claims
  try {
    claims = await verifyAccessToken(match[1])
  } catch (error) {
    logger.warn?.('Store API access token verification failed.', {
      name: error?.name || 'Error',
      message: error?.message || 'Unknown verification error',
    })
    throw new StoreError(401, 'UNAUTHORIZED', 'A valid access token is required.')
  }
  if (!claims || typeof claims.sub !== 'string' || !claims.sub.trim()) {
    throw new StoreError(401, 'UNAUTHORIZED', 'A valid access token is required.')
  }
  return claims
}

function requireAdminGroup(claims) {
  const rawGroups = claims['cognito:groups']
  const groups = Array.isArray(rawGroups) ? rawGroups : typeof rawGroups === 'string' ? [rawGroups] : []
  if (!groups.includes('store-admin')) {
    throw new StoreError(403, 'FORBIDDEN', 'Store administrator access is required.')
  }
}

function customerOrderView(order) {
  const { customerSub, ...visibleOrder } = order
  return visibleOrder
}

function decodeOrderId(value) {
  let id
  try {
    id = decodeURIComponent(value)
  } catch {
    throw new StoreError(400, 'INVALID_ORDER_ID', 'Order ID is invalid.')
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new StoreError(400, 'INVALID_ORDER_ID', 'Order ID is invalid.')
  return id
}

export function createStoreApi({ repository, allowedOrigins = [], verifyAccessToken, logger = console, observeRequest, recognizeChatMessage }) {
  const origins = new Set(allowedOrigins)

  return createServer(async (request, response) => {
    // Count completed API responses, excluding liveness probes and preflights.
    // Only status and elapsed time reach the observer; request data stays private.
    if (observeRequest && request.method !== 'OPTIONS' && /^\/api(?:\/|\?|$)/.test(request.url || '')) {
      const started = performance.now()
      response.once('finish', () => {
        try { observeRequest({ statusCode: response.statusCode, durationMs: performance.now() - started }) }
        catch { logger.warn?.('Store API metrics observation failed.') }
      })
    }
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
      if (request.method === 'POST' && url.pathname === '/api/chat') {
        if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
          throw new StoreError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.')
        }
        const { message, sessionId } = validateChatRequest(await readJson(request))
        if (!recognizeChatMessage) {
          throw new StoreError(503, 'CHAT_NOT_CONFIGURED', 'Storefront chat is not configured yet.')
        }
        const messages = await recognizeChatMessage({ message, sessionId })
        const safeMessages = Array.isArray(messages)
          ? messages.filter((item) => typeof item === 'string' && item.trim()).slice(0, 5)
          : []
        sendJson(response, 200, {
          messages: safeMessages.length
            ? safeMessages
            : ['I can help with products, sign-in help, or where to view your orders.'],
        })
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
        const claims = await requirePrincipal(request, verifyAccessToken, logger)
        if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
          throw new StoreError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.')
        }
        const { items, idempotencyKey, shippingAddress } = validateOrder(
          await readJson(request),
          String(request.headers['idempotency-key'] || ''),
        )
        const result = await repository.createOrder(claims.sub, items, idempotencyKey, shippingAddress)
        sendJson(response, result.created ? 201 : 200, { order: customerOrderView(result.order) })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/orders/me') {
        const claims = await requirePrincipal(request, verifyAccessToken, logger)
        const orders = await repository.getOrdersForCustomer(claims.sub)
        sendJson(response, 200, { orders: orders.map(customerOrderView) })
        return
      }

      const cancellationMatch = /^\/api\/orders\/([^/]+)\/cancel$/.exec(url.pathname)
      if (request.method === 'POST' && cancellationMatch) {
        const claims = await requirePrincipal(request, verifyAccessToken, logger)
        const orderId = decodeOrderId(cancellationMatch[1])
        const order = await repository.cancelOrder(orderId, claims.sub)
        if (!order) throw new StoreError(404, 'ORDER_NOT_FOUND', 'Order was not found.')
        sendJson(response, 200, { order: customerOrderView(order) })
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/admin/session') {
        const claims = await requirePrincipal(request, verifyAccessToken, logger)
        requireAdminGroup(claims)
        sendJson(response, 200, { role: 'store-admin' })
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/admin/orders') {
        const claims = await requirePrincipal(request, verifyAccessToken, logger)
        requireAdminGroup(claims)
        sendJson(response, 200, { orders: await repository.listOrdersForAdmin() })
        return
      }

      const acceptanceMatch = /^\/api\/admin\/orders\/([^/]+)\/accept$/.exec(url.pathname)
      if (request.method === 'POST' && acceptanceMatch) {
        const claims = await requirePrincipal(request, verifyAccessToken, logger)
        requireAdminGroup(claims)
        const orderId = decodeOrderId(acceptanceMatch[1])
        const result = await repository.acceptOrder(orderId)
        if (!result) throw new StoreError(404, 'ORDER_NOT_FOUND', 'Order was not found.')
        sendJson(response, 200, { order: result.order, accepted: result.accepted })
        return
      }

      const rejectionMatch = /^\/api\/admin\/orders\/([^/]+)\/reject$/.exec(url.pathname)
      if (request.method === 'POST' && rejectionMatch) {
        const claims = await requirePrincipal(request, verifyAccessToken, logger)
        requireAdminGroup(claims)
        if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
          throw new StoreError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.')
        }
        const body = await readJson(request)
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            Object.keys(body).length !== 1 || typeof body.reason !== 'string' ||
            !body.reason.trim() || body.reason.trim().length > 500) {
          throw new StoreError(400, 'REJECTION_REASON_REQUIRED', 'Enter a rejection reason of 1 to 500 characters.')
        }
        const orderId = decodeOrderId(rejectionMatch[1])
        const order = await repository.rejectOrder(orderId, body.reason.trim())
        if (!order) throw new StoreError(404, 'ORDER_NOT_FOUND', 'Order was not found.')
        sendJson(response, 200, { order })
        return
      }

      const adminUpdateMatch = /^\/api\/admin\/orders\/([^/]+)$/.exec(url.pathname)
      if (request.method === 'PATCH' && adminUpdateMatch) {
        const claims = await requirePrincipal(request, verifyAccessToken, logger)
        requireAdminGroup(claims)
        if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
          throw new StoreError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.')
        }
        const orderId = decodeOrderId(adminUpdateMatch[1])
        const updates = validateAdminOrderUpdate(await readJson(request))
        const order = await repository.updateRequestedOrder(orderId, updates)
        if (!order) throw new StoreError(404, 'ORDER_NOT_FOUND', 'Order was not found.')
        sendJson(response, 200, { order })
        return
      }

      if (!['GET', 'POST', 'PATCH', 'OPTIONS'].includes(request.method || '')) {
        response.setHeader('Allow', ALLOWED_METHODS)
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
