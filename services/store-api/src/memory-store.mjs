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

export class MemoryStore {
  constructor(products = seedProducts) {
    this.products = new Map(products.map((product) => [product.id, { ...product }]))
    this.ordersByKey = new Map()
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

  async createOrder(items, idempotencyKey) {
    const existing = this.ordersByKey.get(idempotencyKey)
    if (existing) return { order: existing, created: false }

    const selected = []
    for (const item of items) {
      const product = this.products.get(item.productId)
      if (!product || !product.active) {
        throw new StoreError(404, 'PRODUCT_NOT_FOUND', 'One or more products are unavailable.')
      }
      if (product.stock < item.quantity) {
        throw new StoreError(409, 'INSUFFICIENT_STOCK', 'Requested quantity is unavailable.')
      }
      selected.push({ product, quantity: item.quantity })
    }

    const order = {
      id: randomUUID(),
      status: 'PLACED',
      createdAt: new Date().toISOString(),
      totalCents: selected.reduce((total, entry) => total + entry.product.priceCents * entry.quantity, 0),
      items: selected.map(({ product, quantity }) => ({
        productId: product.id,
        name: product.name,
        quantity,
        unitPriceCents: product.priceCents,
        lineTotalCents: product.priceCents * quantity,
      })),
    }

    for (const { product, quantity } of selected) product.stock -= quantity
    this.ordersByKey.set(idempotencyKey, order)
    return { order, created: true }
  }
}
