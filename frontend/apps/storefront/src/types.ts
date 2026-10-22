export type Product = {
  id: string
  name: string
  category: string
  priceCents: number
  description: string
  color: string
  tag: string
  inStock: boolean
}

export type ShippingAddress = {
  recipientName?: string
  addressLine1?: string
  addressLine2?: string
  locality?: string
  region?: string
  postalCode?: string
  countryCode?: string
}

export type OrderItem = {
  productId: string
  name: string
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
}

export type OrderStatus = 'REQUESTED' | 'CANCELLED' | 'ACCEPTED' | 'REJECTED'

export type CustomerOrder = {
  id: string
  status: OrderStatus
  createdAt: string
  updatedAt: string
  cancelledAt?: string
  acceptedAt?: string
  rejectedAt?: string
  rejectionReason?: string
  totalCents: number
  items: OrderItem[]
  shippingAddress: ShippingAddress | null
}

export type AdminOrder = CustomerOrder & {
  customerSub: string
}

export type OrderInputItem = {
  productId: string
  quantity: number
}

