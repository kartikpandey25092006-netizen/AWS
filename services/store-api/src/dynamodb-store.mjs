import { randomUUID } from 'node:crypto'
import {
  DescribeTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb'
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  paginateQuery,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { StoreError } from './memory-store.mjs'

export const CUSTOMER_ORDERS_INDEX = 'CustomerOrdersIndex'
export const ENTITY_INDEX = 'EntityIndex'

const orderKey = (orderId) => `ORDER#${orderId}`
const productKey = (productId) => `PRODUCT#${productId}`
const customerKey = (customerSub) => `CUSTOMER#${customerSub}`
const idempotencySortKey = (idempotencyKey) => `IDEMPOTENCY#${idempotencyKey}`

function publicProduct(item) {
  if (!item || item.entityType !== 'PRODUCT' || !item.active) return null
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    priceCents: item.priceCents,
    description: item.description,
    color: item.color,
    tag: item.tag,
    inStock: item.stock > 0,
  }
}

function publicOrder(item) {
  if (!item || item.entityType !== 'ORDER') return null
  return {
    id: item.id,
    customerSub: item.customerSub,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    totalCents: item.totalCents,
    items: item.items,
    shippingAddress: item.shippingAddress ?? null,
    ...(item.cancelledAt ? { cancelledAt: item.cancelledAt } : {}),
    ...(item.acceptedAt ? { acceptedAt: item.acceptedAt } : {}),
    ...(item.rejectedAt ? { rejectedAt: item.rejectedAt, rejectionReason: item.rejectionReason } : {}),
  }
}

function hasCompleteShippingAddress(address) {
  return Boolean(
    address && address.recipientName && address.addressLine1 &&
    address.locality && address.postalCode && address.countryCode,
  )
}

function isConditionalFailure(error) {
  return error?.name === 'ConditionalCheckFailedException'
}

function isTransactionCancellation(error) {
  return error?.name === 'TransactionCanceledException'
}

export function createDynamoDbClients({ region, endpoint } = {}) {
  if (!region) throw new Error('AWS_REGION is required when STORE_DATABASE=dynamodb.')
  const client = new DynamoDBClient({
    region,
    maxAttempts: 5,
    ...(endpoint ? { endpoint } : {}),
  })
  const documentClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  })
  return { client, documentClient }
}

export class DynamoDbStore {
  constructor({ client, documentClient, tableName }) {
    if (!tableName) throw new Error('STORE_DYNAMODB_TABLE is required when STORE_DATABASE=dynamodb.')
    this.client = client
    this.documentClient = documentClient
    this.tableName = tableName
  }

  close() {
    this.documentClient.destroy()
  }

  async checkConnection() {
    const result = await this.client.send(new DescribeTableCommand({ TableName: this.tableName }))
    if (result.Table?.TableStatus !== 'ACTIVE') {
      throw new Error(`DynamoDB table ${this.tableName} is not ACTIVE.`)
    }
  }

  async listProducts() {
    const items = await this.#queryAll({
      IndexName: ENTITY_INDEX,
      KeyConditionExpression: 'entityType = :entityType',
      ExpressionAttributeValues: { ':entityType': 'PRODUCT' },
    })
    return items.map(publicProduct).filter(Boolean)
  }

  async getProduct(id) {
    const { Item } = await this.documentClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: productKey(id), sk: productKey(id) },
      ConsistentRead: true,
    }))
    return publicProduct(Item)
  }

  async createOrder(customerSub, items, idempotencyKey, shippingAddress) {
    const existing = await this.#getIdempotentOrder(customerSub, idempotencyKey)
    if (existing) return { order: existing, created: false }

    const selected = await this.#selectProducts(items)
    for (const { product, quantity } of selected) {
      if (product.stock < quantity) {
        throw new StoreError(409, 'INSUFFICIENT_STOCK', 'Requested quantity is currently unavailable.')
      }
    }

    const id = randomUUID()
    const now = new Date().toISOString()
    const orderItems = selected.map(({ product, quantity }) => ({
      productId: product.id,
      name: product.name,
      quantity,
      unitPriceCents: product.priceCents,
      lineTotalCents: product.priceCents * quantity,
    }))
    const order = {
      pk: orderKey(id),
      sk: orderKey(id),
      entityType: 'ORDER',
      entitySortKey: `${now}#${id}`,
      customerKey: customerKey(customerSub),
      customerOrderKey: `${now}#${id}`,
      id,
      customerSub,
      status: 'REQUESTED',
      createdAt: now,
      updatedAt: now,
      totalCents: orderItems.reduce((total, item) => total + item.lineTotalCents, 0),
      items: orderItems,
      shippingAddress: shippingAddress ?? null,
    }
    const marker = {
      pk: customerKey(customerSub),
      sk: idempotencySortKey(idempotencyKey),
      entityType: 'IDEMPOTENCY',
      orderId: id,
      createdAt: now,
    }

    try {
      await this.documentClient.send(new TransactWriteCommand({
        ClientRequestToken: randomUUID(),
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: order,
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: marker,
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
        ],
      }))
      return { order: publicOrder(order), created: true }
    } catch (error) {
      if (!isTransactionCancellation(error)) throw error
      const duplicate = await this.#getIdempotentOrder(customerSub, idempotencyKey)
      if (duplicate) return { order: duplicate, created: false }
      throw error
    }
  }

  async getOrdersForCustomer(customerSub) {
    const items = await this.#queryAll({
      IndexName: CUSTOMER_ORDERS_INDEX,
      KeyConditionExpression: 'customerKey = :customerKey',
      ExpressionAttributeValues: { ':customerKey': customerKey(customerSub) },
      ScanIndexForward: false,
    })
    return items.map(publicOrder).filter(Boolean)
  }

  async getOrderForCustomer(orderId, customerSub) {
    const order = await this.#getOrder(orderId)
    return order?.customerSub === customerSub ? publicOrder(order) : null
  }

  async cancelOrder(orderId, customerSub) {
    const current = await this.#getOrder(orderId)
    if (!current || current.customerSub !== customerSub) return null
    if (current.status === 'CANCELLED') return publicOrder(current)
    if (current.status !== 'REQUESTED') {
      throw new StoreError(409, 'ORDER_NOT_CANCELLABLE', 'Only requested orders can be cancelled.')
    }

    const now = new Date().toISOString()
    try {
      const { Attributes } = await this.documentClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: orderKey(orderId), sk: orderKey(orderId) },
        UpdateExpression: 'SET #status = :cancelled, cancelledAt = :now, updatedAt = :now',
        ConditionExpression: '#status = :requested AND customerSub = :customerSub AND updatedAt = :previousUpdate',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':cancelled': 'CANCELLED',
          ':requested': 'REQUESTED',
          ':customerSub': customerSub,
          ':previousUpdate': current.updatedAt,
          ':now': now,
        },
        ReturnValues: 'ALL_NEW',
      }))
      return publicOrder(Attributes)
    } catch (error) {
      if (!isConditionalFailure(error)) throw error
      const latest = await this.#getOrder(orderId)
      if (!latest || latest.customerSub !== customerSub) return null
      if (latest.status === 'CANCELLED') return publicOrder(latest)
      throw new StoreError(409, 'ORDER_NOT_CANCELLABLE', 'Only requested orders can be cancelled.')
    }
  }

  async listOrdersForAdmin() {
    const items = await this.#queryAll({
      IndexName: ENTITY_INDEX,
      KeyConditionExpression: 'entityType = :entityType',
      ExpressionAttributeValues: { ':entityType': 'ORDER' },
      ScanIndexForward: false,
    })
    return items.map(publicOrder).filter(Boolean)
  }

  async updateRequestedOrder(orderId, updates) {
    const current = await this.#getOrder(orderId)
    if (!current) return null
    if (current.status !== 'REQUESTED') {
      throw new StoreError(409, 'ORDER_NOT_EDITABLE', 'Only requested orders can be changed by an admin.')
    }

    let orderItems = current.items
    if (updates.items) {
      const selected = await this.#selectProducts(updates.items)
      orderItems = selected.map(({ product, quantity }) => ({
        productId: product.id,
        name: product.name,
        quantity,
        unitPriceCents: product.priceCents,
        lineTotalCents: product.priceCents * quantity,
      }))
    }
    const now = new Date().toISOString()

    try {
      const { Attributes } = await this.documentClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: orderKey(orderId), sk: orderKey(orderId) },
        UpdateExpression: 'SET #items = :items, totalCents = :totalCents, updatedAt = :now',
        ConditionExpression: '#status = :requested AND updatedAt = :previousUpdate',
        ExpressionAttributeNames: { '#items': 'items', '#status': 'status' },
        ExpressionAttributeValues: {
          ':items': orderItems,
          ':totalCents': orderItems.reduce((total, item) => total + item.lineTotalCents, 0),
          ':now': now,
          ':requested': 'REQUESTED',
          ':previousUpdate': current.updatedAt,
        },
        ReturnValues: 'ALL_NEW',
      }))
      return publicOrder(Attributes)
    } catch (error) {
      if (!isConditionalFailure(error)) throw error
      const latest = await this.#getOrder(orderId)
      if (!latest) return null
      if (latest.status !== 'REQUESTED') {
        throw new StoreError(409, 'ORDER_NOT_EDITABLE', 'Only requested orders can be changed by an admin.')
      }
      throw new StoreError(409, 'ORDER_CHANGED', 'The order changed; refresh it before editing again.')
    }
  }

  async acceptOrder(orderId) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.#getOrder(orderId)
      if (!current) return null
      if (current.status === 'ACCEPTED') return { order: publicOrder(current), accepted: false }
      if (current.status !== 'REQUESTED') {
        throw new StoreError(409, 'ORDER_NOT_ACCEPTABLE', 'Only requested orders can be accepted.')
      }
      if (!hasCompleteShippingAddress(current.shippingAddress)) {
        throw new StoreError(409, 'SHIPPING_ADDRESS_REQUIRED', 'Add a complete shipping address before acceptance.')
      }

      const products = await this.#selectProducts(current.items)
      for (const { product, quantity } of products) {
        if (product.stock < quantity) {
          throw new StoreError(409, 'INSUFFICIENT_STOCK', 'Stock changed; this order cannot be accepted.')
        }
      }

      const now = new Date().toISOString()
      const transactionItems = products.map(({ product, quantity }) => ({
        Update: {
          TableName: this.tableName,
          Key: { pk: productKey(product.id), sk: productKey(product.id) },
          UpdateExpression: 'SET stock = stock - :quantity, updatedAt = :now',
          ConditionExpression: 'active = :active AND stock >= :quantity',
          ExpressionAttributeValues: { ':quantity': quantity, ':active': true, ':now': now },
        },
      }))
      transactionItems.push({
        Update: {
          TableName: this.tableName,
          Key: { pk: orderKey(orderId), sk: orderKey(orderId) },
          UpdateExpression: 'SET #status = :accepted, acceptedAt = :now, updatedAt = :now',
          ConditionExpression: '#status = :requested AND updatedAt = :previousUpdate',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':accepted': 'ACCEPTED',
            ':requested': 'REQUESTED',
            ':previousUpdate': current.updatedAt,
            ':now': now,
          },
        },
      })

      try {
        await this.documentClient.send(new TransactWriteCommand({
          ClientRequestToken: randomUUID(),
          TransactItems: transactionItems,
        }))
        return { order: publicOrder({ ...current, status: 'ACCEPTED', acceptedAt: now, updatedAt: now }), accepted: true }
      } catch (error) {
        if (!isTransactionCancellation(error)) throw error
        const latest = await this.#getOrder(orderId)
        if (!latest) return null
        if (latest.status === 'ACCEPTED') return { order: publicOrder(latest), accepted: false }
        if (latest.status !== 'REQUESTED') {
          throw new StoreError(409, 'ORDER_NOT_ACCEPTABLE', 'Only requested orders can be accepted.')
        }
        const latestProducts = await this.#selectProducts(latest.items)
        if (latestProducts.some(({ product, quantity }) => product.stock < quantity)) {
          throw new StoreError(409, 'INSUFFICIENT_STOCK', 'Stock changed; this order cannot be accepted.')
        }
      }
    }
    throw new StoreError(409, 'ORDER_CHANGED', 'The order changed; refresh it before accepting again.')
  }

  async rejectOrder(orderId, reason) {
    const current = await this.#getOrder(orderId)
    if (!current) return null
    if (current.status !== 'REQUESTED') {
      throw new StoreError(409, 'ORDER_NOT_REJECTABLE', 'Only requested orders can be rejected.')
    }
    const now = new Date().toISOString()
    try {
      const { Attributes } = await this.documentClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: orderKey(orderId), sk: orderKey(orderId) },
        UpdateExpression: 'SET #status = :rejected, rejectionReason = :reason, rejectedAt = :now, updatedAt = :now',
        ConditionExpression: '#status = :requested AND updatedAt = :previousUpdate',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':rejected': 'REJECTED',
          ':requested': 'REQUESTED',
          ':previousUpdate': current.updatedAt,
          ':reason': reason,
          ':now': now,
        },
        ReturnValues: 'ALL_NEW',
      }))
      return publicOrder(Attributes)
    } catch (error) {
      if (!isConditionalFailure(error)) throw error
      const latest = await this.#getOrder(orderId)
      if (!latest) return null
      throw new StoreError(409, 'ORDER_NOT_REJECTABLE', 'The order changed; refresh it before rejecting.')
    }
  }

  async #getOrder(orderId) {
    const { Item } = await this.documentClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: orderKey(orderId), sk: orderKey(orderId) },
      ConsistentRead: true,
    }))
    return Item?.entityType === 'ORDER' ? Item : null
  }

  async #getIdempotentOrder(customerSub, idempotencyKey) {
    const { Item: marker } = await this.documentClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: customerKey(customerSub), sk: idempotencySortKey(idempotencyKey) },
      ConsistentRead: true,
    }))
    if (!marker?.orderId) return null
    return publicOrder(await this.#getOrder(marker.orderId))
  }

  async #selectProducts(items) {
    const requestedKeys = items.map(({ productId }) => ({ pk: productKey(productId), sk: productKey(productId) }))
    const products = []
    let keys = requestedKeys
    for (let attempt = 0; keys.length > 0 && attempt < 5; attempt += 1) {
      const result = await this.documentClient.send(new BatchGetCommand({
        RequestItems: { [this.tableName]: { Keys: keys, ConsistentRead: true } },
      }))
      products.push(...(result.Responses?.[this.tableName] || []))
      keys = result.UnprocessedKeys?.[this.tableName]?.Keys || []
    }
    if (keys.length > 0) throw new Error('DynamoDB did not process all requested product reads.')

    const byId = new Map(products.map((product) => [product.id, product]))
    return items.map(({ productId, quantity }) => {
      const product = byId.get(productId)
      if (!product || product.entityType !== 'PRODUCT' || !product.active) {
        throw new StoreError(404, 'PRODUCT_NOT_FOUND', 'One or more products are unavailable.')
      }
      return { product, quantity }
    })
  }

  async #queryAll(input) {
    const items = []
    for await (const page of paginateQuery(
      { client: this.documentClient },
      {
        TableName: this.tableName,
        ...input,
      },
    )) {
      items.push(...(page.Items || []))
    }
    return items
  }
}

export function productRecord(product, now = new Date().toISOString()) {
  return {
    pk: productKey(product.id),
    sk: productKey(product.id),
    entityType: 'PRODUCT',
    entitySortKey: product.id,
    ...product,
    createdAt: now,
    updatedAt: now,
  }
}
