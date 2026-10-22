import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, CheckCircle2, CircleAlert, LoaderCircle, LogIn, PackageCheck, Save, ShieldCheck, XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { acceptAdminOrder, cancelMyOrder, errorMessage, listAdminOrders, listMyOrders, rejectAdminOrder, updateAdminOrder } from './api'
import { useStoreAuth } from './auth'
import { cloudOpsUrl } from './navigation'
import type { AdminOrder, CustomerOrder, OrderInputItem, ShippingAddress } from './types'
import './store.css'

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
const orderDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function PortalShell({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  const auth = useStoreAuth()
  return (
    <div className="store-shell store-portal-shell">
      <header className="store-portal-header">
        <Link className="store-wordmark" to="/">fieldwork<span>.</span></Link>
        <nav aria-label="Store account navigation">
          <Link to="/"><ArrowLeft size={15} /> Store</Link>
          <Link to="/account/orders">My orders</Link>
          {auth.isAdmin && <Link to="/admin/orders">Admin orders</Link>}
          {auth.isAuthenticated && auth.isAdmin && cloudOpsUrl && <a href={cloudOpsUrl} target="_blank" rel="noreferrer">CloudOps</a>}
        </nav>
        {auth.isAuthenticated && <button className="store-signout" onClick={() => void auth.signOut()}>Sign out</button>}
      </header>
      <main className="store-portal-main">
        <div className="store-portal-title">
          <span className="store-eyebrow"><span className="store-eyebrow-line" /> {eyebrow}</span>
          <h1>{title}</h1>
          {auth.isAuthenticated && <p>Signed in as {auth.userLabel}</p>}
        </div>
        {children}
      </main>
    </div>
  )
}

function AuthGate({ admin = false }: { admin?: boolean }) {
  const auth = useStoreAuth()
  if (!auth.configured) {
    return <StatePanel icon={<CircleAlert />} title="Storefront sign-in is not configured" description="Browsing is still available. The account and admin areas will work after the Storefront Cognito configuration is completed." />
  }
  if (auth.isLoading) {
    return <StatePanel icon={<LoaderCircle className="spin" />} title="Checking your session" description="This should only take a moment." />
  }
  if (auth.error) {
    return <StatePanel icon={<CircleAlert />} title="Sign-in could not be completed" description={auth.error} action={<><button className="store-primary-button" onClick={() => void auth.signIn(window.location.pathname, true)}>Try sign-in again</button>{admin && <button className="store-outline-action" onClick={() => void auth.signIn('/account/orders', true)}>Customer sign in</button>}</>} />
  }
  if (!auth.isAuthenticated) {
    return <StatePanel icon={<LogIn />} title={admin ? 'Administrator sign-in required' : 'Sign in to see your orders'} description={admin ? 'Sign in with your administrator account to review and manage customer orders.' : 'Your order history is private and tied to your Storefront account.'} action={<button className="store-primary-button" onClick={() => void auth.signIn(window.location.pathname, true)}>{admin ? 'Admin sign in' : 'Customer sign in'}</button>} />
  }
  if (admin && !auth.isAdmin) {
    return <StatePanel icon={<ShieldCheck />} title="Administrator access required" description="You are signed in with a customer account. Sign in with your administrator account to manage orders." action={<button className="store-primary-button" onClick={() => void auth.signIn('/admin/orders', true)}>Sign in as admin</button>} />
  }
  return null
}

function StatePanel({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <section className="store-state-panel">{icon}<h2>{title}</h2><p>{description}</p>{action}</section>
}

function StatusBadge({ status }: { status: CustomerOrder['status'] }) {
  const icon = status === 'ACCEPTED' ? <CheckCircle2 size={14} /> : status === 'CANCELLED' || status === 'REJECTED' ? <XCircle size={14} /> : <LoaderCircle size={14} />
  return <span className={`store-order-status status-${status.toLowerCase()}`}>{icon}{status.toLowerCase()}</span>
}

function AddressSummary({ address }: { address: ShippingAddress | null }) {
  if (!address || !address.recipientName || !address.addressLine1 || !address.locality || !address.postalCode || !address.countryCode) {
    return <span className="store-address-missing"><CircleAlert size={14} /> Address incomplete. Ask the customer to submit a new order with a complete address.</span>
  }
  return (
    <address>
      {address.recipientName}<br />
      {address.addressLine1}{address.addressLine2 ? <><br />{address.addressLine2}</> : null}<br />
      {[address.locality, address.region, address.postalCode].filter(Boolean).join(', ')}<br />
      {address.countryCode}
    </address>
  )
}

export function CustomerOrdersPage() {
  const auth = useStoreAuth()
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [workingId, setWorkingId] = useState('')
  const [error, setError] = useState('')

  const loadOrders = useCallback(async () => {
    if (!auth.accessToken) return
    setLoading(true)
    setError('')
    try {
      setOrders(await listMyOrders(auth.accessToken))
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [auth.accessToken])

  // The effect starts the initial asynchronous fetch for the active Cognito session.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void loadOrders() }, [loadOrders])

  const cancel = async (orderId: string) => {
    if (!auth.accessToken) return
    setWorkingId(orderId)
    setError('')
    try {
      const updated = await cancelMyOrder(auth.accessToken, orderId)
      setOrders((current) => current.map((order) => order.id === orderId ? updated : order))
    } catch (cancelError) {
      setError(errorMessage(cancelError))
    } finally {
      setWorkingId('')
    }
  }

  const gate = <AuthGate />
  if (!auth.configured || auth.isLoading || !auth.isAuthenticated || auth.error) {
    return <PortalShell title="Your orders" eyebrow="CUSTOMER ACCOUNT">{gate}</PortalShell>
  }

  return (
    <PortalShell title="Your orders" eyebrow="CUSTOMER ACCOUNT">
      <div className="store-portal-note">Orders are saved to your account and remain available after the Store API restarts.</div>
      {error && <div className="store-inline-error" role="alert"><CircleAlert size={16} />{error}<button onClick={() => void loadOrders()}>Retry</button></div>}
      {loading ? <StatePanel icon={<LoaderCircle className="spin" />} title="Loading orders" description="Retrieving your latest order history." /> : null}
      {!loading && !error && !orders.length ? <StatePanel icon={<PackageCheck />} title="No orders yet" description="When you submit an order request, it will appear here." action={<Link className="store-primary-button" to="/">Browse products</Link>} /> : null}
      <div className="store-order-list">
        {orders.map((order) => <article className="store-order-card" key={order.id}>
          <div className="store-order-card-heading">
            <div><span>Order {order.id.slice(0, 8)}</span><strong>{orderDate.format(new Date(order.createdAt))}</strong></div>
            <StatusBadge status={order.status} />
          </div>
          <div className="store-order-layout">
            <div>{order.items.map((item) => <p className="store-order-line" key={item.productId}><span>{item.quantity} × {item.name}</span><strong>{money(item.lineTotalCents)}</strong></p>)}<p className="store-order-total"><span>Total</span><strong>{money(order.totalCents)}</strong></p></div>
            <div className="store-order-address"><h3>Shipping address</h3><AddressSummary address={order.shippingAddress} /></div>
          </div>
          {order.status === 'REJECTED' && <p className="store-rejection-reason"><strong>Reason for rejection:</strong> {order.rejectionReason}</p>}
          {order.status === 'REQUESTED' && <div className="store-order-actions"><span>You can cancel this request until an admin accepts it.</span><button className="store-danger-button" disabled={workingId === order.id} onClick={() => void cancel(order.id)}>{workingId === order.id ? 'Cancelling…' : 'Cancel order'}</button></div>}
        </article>)}
      </div>
    </PortalShell>
  )
}

export function AdminOrdersPage() {
  const auth = useStoreAuth()
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [workingId, setWorkingId] = useState('')
  const [error, setError] = useState('')

  const loadOrders = useCallback(async () => {
    if (!auth.accessToken || !auth.isAdmin) return
    setLoading(true)
    setError('')
    try {
      setOrders(await listAdminOrders(auth.accessToken))
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [auth.accessToken, auth.isAdmin])

  // The effect starts the initial asynchronous fetch for the active admin session.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void loadOrders() }, [loadOrders])

  const save = async (orderId: string, items: OrderInputItem[]) => {
    if (!auth.accessToken) return
    setWorkingId(orderId)
    setError('')
    try {
      const updated = await updateAdminOrder(auth.accessToken, orderId, { items })
      setOrders((current) => current.map((order) => order.id === orderId ? updated : order))
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setWorkingId('')
    }
  }

  const accept = async (orderId: string) => {
    if (!auth.accessToken) return
    setWorkingId(orderId)
    setError('')
    try {
      const updated = await acceptAdminOrder(auth.accessToken, orderId)
      setOrders((current) => current.map((order) => order.id === orderId ? updated : order))
    } catch (acceptError) {
      setError(errorMessage(acceptError))
    } finally {
      setWorkingId('')
    }
  }

  const reject = async (orderId: string, reason: string) => {
    if (!auth.accessToken) return
    setWorkingId(orderId)
    setError('')
    try {
      const updated = await rejectAdminOrder(auth.accessToken, orderId, reason)
      setOrders((current) => current.map((order) => order.id === orderId ? updated : order))
    } catch (rejectError) {
      setError(errorMessage(rejectError))
    } finally {
      setWorkingId('')
    }
  }

  const gate = <AuthGate admin />
  if (!auth.configured || auth.isLoading || !auth.isAuthenticated || !auth.isAdmin || auth.error) {
    return <PortalShell title="Order management" eyebrow="STOREFRONT ADMIN">{gate}</PortalShell>
  }

  return (
    <PortalShell title="Order management" eyebrow="STOREFRONT ADMIN">
      <div className="store-portal-note">Shipping addresses are provided by customers and cannot be changed by admins. Accepting an order rechecks stock and decrements it once.</div>
      {error && <div className="store-inline-error" role="alert"><CircleAlert size={16} />{error}<button onClick={() => void loadOrders()}>Refresh</button></div>}
      {loading ? <StatePanel icon={<LoaderCircle className="spin" />} title="Loading orders" description="Retrieving the administrator queue." /> : null}
      {!loading && !error && !orders.length ? <StatePanel icon={<PackageCheck />} title="No orders to review" description="Customer order requests will appear here." /> : null}
      <div className="store-order-list">
        {orders.map((order) => <AdminOrderCard key={`${order.id}-${order.updatedAt}`} order={order} busy={workingId === order.id} onSave={save} onAccept={accept} onReject={reject} />)}
      </div>
    </PortalShell>
  )
}

function AdminOrderCard({ order, busy, onSave, onAccept, onReject }: { order: AdminOrder; busy: boolean; onSave: (orderId: string, items: OrderInputItem[]) => Promise<void>; onAccept: (orderId: string) => Promise<void>; onReject: (orderId: string, reason: string) => Promise<void> }) {
  const [items, setItems] = useState<OrderInputItem[]>(order.items.map(({ productId, quantity }) => ({ productId, quantity })))
  const [rejectionReason, setRejectionReason] = useState('')
  const editable = order.status === 'REQUESTED'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void onSave(order.id, items)
  }

  return (
    <article className="store-order-card store-admin-order-card">
      <div className="store-order-card-heading">
        <div><span>Order {order.id.slice(0, 8)}</span><strong>{orderDate.format(new Date(order.createdAt))}</strong><small>Customer {order.customerSub}</small></div>
        <StatusBadge status={order.status} />
      </div>
      <form onSubmit={submit}>
        <div className="store-admin-grid">
          <section><h3>Items</h3>{order.items.map((item, index) => <label className="store-admin-item" key={item.productId}><span>{item.name}<small>{money(item.unitPriceCents)} each</small></span><input aria-label={`${item.name} quantity`} type="number" min="1" max="10" disabled={!editable || busy} value={items[index]?.quantity || 1} onChange={(event) => setItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, quantity: Math.min(10, Math.max(1, Number(event.target.value) || 1)) } : entry))} /></label>)}</section>
          <section className="store-order-address"><h3>Shipping address</h3><AddressSummary address={order.shippingAddress} /></section>
        </div>
        {editable && <div className="store-admin-rejection"><label htmlFor={`reject-${order.id}`}>Reason for rejection</label><textarea id={`reject-${order.id}`} maxLength={500} disabled={busy} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Explain clearly why this order cannot be accepted" /><small>Required when rejecting. The customer will see this reason.</small></div>}
        {order.status === 'REJECTED' && <p className="store-rejection-reason"><strong>Reason for rejection:</strong> {order.rejectionReason}</p>}
        <div className="store-admin-actions">
          <span>Total {money(order.totalCents)}</span>
          {editable ? <><button type="submit" className="store-outline-action" disabled={busy}><Save size={15} /> Save quantities</button><button type="button" className="store-primary-button" disabled={busy} onClick={() => void onAccept(order.id)}><PackageCheck size={16} /> Accept order</button><button type="button" className="store-danger-button" disabled={busy || !rejectionReason.trim()} onClick={() => void onReject(order.id, rejectionReason.trim())}>Reject order</button></> : <span>This order is no longer editable.</span>}
        </div>
      </form>
    </article>
  )
}
