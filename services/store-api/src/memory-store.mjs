import { randomUUID } from 'node:crypto'

export const seedProducts = [
  { id: 'orbit-desk-lamp', name: 'Orbit Desk Lamp', category: 'Workspace', priceCents: 6800, description: 'A warm, focused glow for long nights and big ideas.', color: 'sand', tag: 'Bestseller', stock: 25, active: true },
  { id: 'field-notes-set', name: 'Field Notes Set', category: 'Paper goods', priceCents: 2400, description: 'Three lay-flat notebooks, ready for whatever comes next.', color: 'sage', tag: 'Set of 3', stock: 40, active: true },
  { id: 'everyday-tote', name: 'Everyday Carry Tote', category: 'Accessories', priceCents: 4200, description: 'Room for the daily essentials, made to go everywhere.', color: 'rose', tag: 'New', stock: 35, active: true },
  { id: 'ceramic-pour-over', name: 'Ceramic Pour Over', category: 'Kitchen', priceCents: 5600, description: 'A quiet morning ritual in hand-finished stoneware.', color: 'blue', tag: 'Small batch', stock: 16, active: true },
  { id: 'desktop-organizer', name: 'Modular Desk Tray', category: 'Workspace', priceCents: 3800, description: 'A place for the small things that keep a day moving.', color: 'clay', tag: 'Designed well', stock: 30, active: true },
  { id: 'weekend-bottle', name: 'Weekend Bottle', category: 'Accessories', priceCents: 3200, description: 'A light, double-wall bottle for days outside the routine.', color: 'mint', tag: 'Everyday', stock: 50, active: true },
]

export class StoreError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function copy(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function orderIdempotencyKey(customerSub, idempotencyKey) {
  return `${customerSub}\u0000${idempotencyKey}`
}

function hasCompleteShippingAddress(address) {
  return Boolean(
    address &&
    address.recipientName &&
    address.addressLine1 &&
    address.locality &&
    address.postalCode &&
    address.countryCode,
  )
}

export class MemoryStore {
  constructor(products = seedProducts) {
    this.products = new Map(products.map((product) => [product.id, { ...product }]))
    this.ordersById = new Map()
    this.orderIdsByIdempotencyKey = new Map()
  }

  async listProducts() {
    return [...this.products.values()]
      .filter((product) => product.active)
      .map(({ stock, active, ...product }) => ({ ...product, inStock: stock > 0 }))
  }

  async getProduct(id) {
    const product = this.products.get(id)
    if (!product || !product.active) return null
    const { stock, active, ...publicProduct } = product
    return { ...publicProduct, inStock: stock > 0 }
  }

  async createOrder(customerSub, items, idempotencyKey, shippingAddress) {
    const scopedKey = orderIdempotencyKey(customerSub, idempotencyKey)
    const existingOrderId = this.orderIdsByIdempotencyKey.get(scopedKey)
    if (existingOrderId) {
      return { order: copy(this.ordersById.get(existingOrderId)), created: false }
    }

    const selected = this.#selectProducts(items)
    for (const { product, quantity } of selected) {
      if (product.stock < quantity) {
        throw new StoreError(409, 'INSUFFICIENT_STOCK', 'Requested quantity is currently unavailable.')
      }
    }

    const order = {
      id: randomUUID(),
      customerSub,
      status: 'REQUESTED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalCents: selected.reduce((total, entry) => total + entry.product.priceCents * entry.quantity, 0),
      items: selected.map(({ product, quantity }) => ({
        productId: product.id,
        name: product.name,
        quantity,
        unitPriceCents: product.priceCents,
        lineTotalCents: product.priceCents * quantity,
      })),
      shippingAddress: copy(shippingAddress) ?? null,
    }

    // Requests do not reserve or decrement inventory. Stock is checked again at acceptance.
    this.ordersById.set(order.id, order)
    this.orderIdsByIdempotencyKey.set(scopedKey, order.id)
    return { order: copy(order), created: true }
  }

  async getOrdersForCustomer(customerSub) {
    return [...this.ordersById.values()]
      .filter((order) => order.customerSub === customerSub)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(copy)
  }

  async getOrderForCustomer(orderId, customerSub) {
    const order = this.ordersById.get(orderId)
    if (!order || order.customerSub !== customerSub) return null
    return copy(order)
  }

  async cancelOrder(orderId, customerSub) {
    const order = this.ordersById.get(orderId)
    if (!order || order.customerSub !== customerSub) return null
    if (order.status === 'CANCELLED') return copy(order)
    if (order.status !== 'REQUESTED') {
      throw new StoreError(409, 'ORDER_NOT_CANCELLABLE', 'Only requested orders can be cancelled.')
    }
    order.status = 'CANCELLED'
    order.cancelledAt = new Date().toISOString()
    order.updatedAt = order.cancelledAt
    return copy(order)
  }

  async listOrdersForAdmin() {
    return [...this.ordersById.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(copy)
  }

  async updateRequestedOrder(orderId, updates) {
    const order = this.ordersById.get(orderId)
    if (!order) return null
    if (order.status !== 'REQUESTED') {
      throw new StoreError(409, 'ORDER_NOT_EDITABLE', 'Only requested orders can be changed by an admin.')
    }

    if (updates.items) {
      const selected = this.#selectProducts(updates.items)
      order.items = selected.map(({ product, quantity }) => ({
        productId: product.id,
        name: product.name,
        quantity,
        unitPriceCents: product.priceCents,
        lineTotalCents: product.priceCents * quantity,
      }))
      order.totalCents = order.items.reduce((total, item) => total + item.lineTotalCents, 0)
    }
    order.updatedAt = new Date().toISOString()
    return copy(order)
  }

  async acceptOrder(orderId) {
    const order = this.ordersById.get(orderId)
    if (!order) return null
    if (order.status === 'ACCEPTED') return { order: copy(order), accepted: false }
    if (order.status !== 'REQUESTED') {
      throw new StoreError(409, 'ORDER_NOT_ACCEPTABLE', 'Only requested orders can be accepted.')
    }
    if (!hasCompleteShippingAddress(order.shippingAddress)) {
      throw new StoreError(409, 'SHIPPING_ADDRESS_REQUIRED', 'Add a complete shipping address before acceptance.')
    }

    const selected = this.#selectProducts(order.items)
    for (const { product, quantity } of selected) {
      if (product.stock < quantity) {
        throw new StoreError(409, 'INSUFFICIENT_STOCK', 'Stock changed; this order cannot be accepted.')
      }
    }

    // This in-memory operation has no await between checking and decrementing. The DynamoDB
    // repository preserves the same invariant with a conditional transaction.
    for (const { product, quantity } of selected) product.stock -= quantity
    order.status = 'ACCEPTED'
    order.acceptedAt = new Date().toISOString()
    order.updatedAt = order.acceptedAt
    return { order: copy(order), accepted: true }
  }

  async rejectOrder(orderId, reason) {
    const order = this.ordersById.get(orderId)
    if (!order) return null
    if (order.status !== 'REQUESTED') {
      throw new StoreError(409, 'ORDER_NOT_REJECTABLE', 'Only requested orders can be rejected.')
    }
    const now = new Date().toISOString()
    order.status = 'REJECTED'
    order.rejectionReason = reason
    order.rejectedAt = now
    order.updatedAt = now
    return copy(order)
  }

  #selectProducts(items) {
    return items.map(({ productId, quantity }) => {
      const product = this.products.get(productId)
      if (!product || !product.active) {
        throw new StoreError(404, 'PRODUCT_NOT_FOUND', 'One or more products are unavailable.')
      }
      return { product, quantity }
    })
  }
}
