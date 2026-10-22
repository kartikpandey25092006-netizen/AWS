import type { AdminOrder, CustomerOrder, OrderInputItem, Product, ShippingAddress } from './types'

const configuredBaseUrl = import.meta.env.VITE_STOREFRONT_API_URL ?? (import.meta.env.PROD ? '' : 'http://127.0.0.1:3100')
export const storeApiBaseUrl = configuredBaseUrl.replace(/\/+$/, '')

type ApiErrorBody = {
  error?: {
    code?: string
    message?: string
  }
}

export class StoreApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'StoreApiError'
    this.status = status
    this.code = code
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH'
  token?: string
  body?: unknown
  idempotencyKey?: string
}

async function requestJson<T>(
  path: string,
  options: RequestOptions = {},
  baseUrl = storeApiBaseUrl,
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' })
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)

  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new StoreApiError(0, 'API_UNAVAILABLE', 'The Store API is unavailable. Start it locally or check its configured URL.')
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    if (response.ok) throw new StoreApiError(response.status, 'INVALID_RESPONSE', 'The Store API returned an invalid response.')
  }

  if (!response.ok) {
    const body = payload as ApiErrorBody | null
    throw new StoreApiError(
      response.status,
      body?.error?.code || 'REQUEST_FAILED',
      body?.error?.message || 'The request could not be completed.',
    )
  }

  return payload as T
}

export async function listProducts(): Promise<Product[]> {
  return (await requestJson<{ products: Product[] }>('/api/products')).products
}

export async function sendChatMessage(message: string, sessionId: string): Promise<string[]> {
  return (await requestJson<{ messages: string[] }>('/api/chat', {
    method: 'POST',
    body: { message, sessionId },
  }, '')).messages
}

export async function createOrder(
  token: string,
  items: OrderInputItem[],
  idempotencyKey: string,
  shippingAddress: ShippingAddress,
): Promise<CustomerOrder> {
  const body = { items, shippingAddress }
  return (await requestJson<{ order: CustomerOrder }>('/api/orders', {
    method: 'POST',
    token,
    idempotencyKey,
    body,
  })).order
}

export async function listMyOrders(token: string): Promise<CustomerOrder[]> {
  return (await requestJson<{ orders: CustomerOrder[] }>('/api/orders/me', { token })).orders
}

export async function cancelMyOrder(token: string, orderId: string): Promise<CustomerOrder> {
  return (await requestJson<{ order: CustomerOrder }>(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    token,
  })).order
}

export async function listAdminOrders(token: string): Promise<AdminOrder[]> {
  return (await requestJson<{ orders: AdminOrder[] }>('/api/admin/orders', { token })).orders
}

export async function verifyAdminSession(token: string): Promise<void> {
  const session = await requestJson<{ role: string }>('/api/admin/session', { token })
  if (session.role !== 'store-admin') throw new Error('Administrator access could not be verified.')
}

export async function updateAdminOrder(
  token: string,
  orderId: string,
  updates: { items: OrderInputItem[] },
): Promise<AdminOrder> {
  return (await requestJson<{ order: AdminOrder }>(`/api/admin/orders/${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    token,
    body: updates,
  })).order
}

export async function acceptAdminOrder(token: string, orderId: string): Promise<AdminOrder> {
  return (await requestJson<{ order: AdminOrder }>(`/api/admin/orders/${encodeURIComponent(orderId)}/accept`, {
    method: 'POST',
    token,
  })).order
}

export async function rejectAdminOrder(token: string, orderId: string, reason: string): Promise<AdminOrder> {
  return (await requestJson<{ order: AdminOrder }>(`/api/admin/orders/${encodeURIComponent(orderId)}/reject`, {
    method: 'POST',
    token,
    body: { reason },
  })).order
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

