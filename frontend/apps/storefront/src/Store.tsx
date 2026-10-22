import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, CircleAlert, LoaderCircle, Menu, Minus, Plus, Search, ShieldCheck, ShoppingBag, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { createOrder, errorMessage, listProducts } from './api'
import { useStoreAuth } from './auth'
import { cloudOpsUrl } from './navigation'
import { Button } from './components/ui/button'
import { Badge } from './components/ui/badge'
import { Input } from './components/ui/input'
import ChatWidget from './ChatWidget'
import type { Product, ShippingAddress } from './types'
import './store.css'

const cartStorageKey = 'fieldwork:cart'
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

function readCart(): Record<string, number> {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(cartStorageKey) || '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => Number.isInteger(entry[1]) && Number(entry[1]) > 0 && Number(entry[1]) <= 10))
  } catch {
    return {}
  }
}

function compactAddress(address: ShippingAddress): ShippingAddress {
  const entries = Object.entries(address).map(([key, value]) => [key, value?.trim()]).filter(([, value]) => value)
  return Object.fromEntries(entries) as ShippingAddress
}

function Store() {
  const auth = useStoreAuth()
  const navigate = useNavigate()
  const [products, setProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [productsError, setProductsError] = useState('')
  const [category, setCategory] = useState('All pieces')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<Record<string, number>>(readCart)
  const [shippingAddress, setShippingAddress] = useState<ShippingAddress>({})
  const [cartOpen, setCartOpen] = useState(false)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    listProducts()
      .then((result) => { if (active) { setProducts(result); setProductsError('') } })
      .catch((loadError) => { if (active) setProductsError(errorMessage(loadError)) })
      .finally(() => { if (active) setProductsLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    window.sessionStorage.setItem(cartStorageKey, JSON.stringify(cart))
  }, [cart])

  const categories = useMemo(() => ['All pieces', ...new Set(products.map((product) => product.category))], [products])
  const filtered = useMemo(() => products.filter((product) =>
    (category === 'All pieces' || product.category === category) &&
    `${product.name} ${product.description} ${product.category}`.toLowerCase().includes(search.toLowerCase())
  ), [category, products, search])
  const cartItems = products.filter((product) => cart[product.id])
  const quantity = Object.values(cart).reduce((sum, count) => sum + count, 0)
  const subtotal = cartItems.reduce((sum, product) => sum + product.priceCents * cart[product.id], 0)

  const showNotice = (message: string, duration = 3500) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), duration)
  }

  const updateQuantity = (id: string, amount: number) => {
    setCart((current) => {
      const next = { ...current, [id]: Math.min(10, Math.max(0, (current[id] || 0) + amount)) }
      if (!next[id]) delete next[id]
      return next
    })
  }

  const requestSignIn = async (returnPath: string) => {
    setMobileNav(false)
    if (!auth.configured) {
      showNotice('Storefront sign-in is not configured yet.')
      return
    }
    try {
      await auth.signIn(returnPath, true)
    } catch (signInError) {
      showNotice(errorMessage(signInError), 5000)
    }
  }

  const checkout = async () => {
    if (!quantity || checkoutBusy) return
    if (!auth.configured) {
      showNotice('Storefront sign-in is not configured yet.')
      return
    }
    if (!auth.isAuthenticated || !auth.accessToken) {
      setCartOpen(false)
      await auth.signIn('/')
      return
    }
    const address = compactAddress(shippingAddress)
    if (!['recipientName', 'addressLine1', 'locality', 'postalCode', 'countryCode'].every((field) => address[field as keyof ShippingAddress])) {
      showNotice('Enter a complete shipping address before placing your order.', 5000)
      return
    }
    if (!/^[A-Z]{2}$/.test(address.countryCode || '')) {
      showNotice('Use a two-letter country code, such as US or IN.', 5000)
      return
    }

    setCheckoutBusy(true)
    try {
      await createOrder(
        auth.accessToken,
        cartItems.map((product) => ({ productId: product.id, quantity: cart[product.id] })),
        window.crypto.randomUUID(),
        address,
      )
      setCart({})
      setShippingAddress({})
      setCartOpen(false)
      navigate('/account/orders')
    } catch (checkoutError) {
      showNotice(errorMessage(checkoutError), 5000)
    } finally {
      setCheckoutBusy(false)
    }
  }

  const updateAddress = (field: keyof ShippingAddress, value: string) => setShippingAddress((current) => ({ ...current, [field]: value }))

  return (
    <div className="store-shell">
      <div className="store-announcement">A little care goes a long way <span>Physical products · no payment collected</span></div>
      <header className="store-header">
        <button className="store-mobile-toggle" onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle menu"><Menu size={20} /></button>
        <a className="store-wordmark" href="#home" aria-label="Fieldwork home">fieldwork<span>.</span></a>
        <nav className={mobileNav ? 'store-nav is-open' : 'store-nav'} aria-label="Main navigation">
          <a href="#shop" onClick={() => setMobileNav(false)}>Shop</a><a href="#story" onClick={() => setMobileNav(false)}>Our story</a>
          {auth.isAuthenticated ? <Link to="/account/orders" onClick={() => setMobileNav(false)}>My orders</Link> : <button type="button" disabled={auth.isLoading} onClick={() => void requestSignIn('/account/orders')}>Customer sign in</button>}
          {auth.isAdmin ? <Link to="/admin/orders" onClick={() => setMobileNav(false)}>Admin orders</Link> : <button type="button" disabled={auth.isLoading} onClick={() => void requestSignIn('/admin/orders')}>Admin sign in</button>}
          {auth.isAuthenticated && auth.isAdmin && cloudOpsUrl && <a className="store-nav-dashboard" href={cloudOpsUrl} target="_blank" rel="noreferrer">CloudOps dashboard <ArrowRight size={14} /></a>}
        </nav>
        <div className="store-header-actions">
          {auth.isAuthenticated && <Link className="store-user" to="/account/orders" title={auth.userLabel}>{auth.userLabel}</Link>}
          <Button variant="ghost" className="store-cart-button" onClick={() => setCartOpen(true)} aria-label={`Open cart with ${quantity} items`}><ShoppingBag size={19} /><span>Bag</span><b>{quantity}</b></Button>
        </div>
      </header>

      <main id="home">
        <section className="store-hero">
          <div className="store-hero-copy">
            <div className="store-eyebrow"><span className="store-eyebrow-line" /> OBJECTS FOR EVERYDAY LIVING</div>
            <h1>Make room<br />for <em>good things.</em></h1>
            <p>Thoughtful pieces for slower mornings, clearer desks, and the little rituals that make a day feel like yours.</p>
            <a className="store-primary-button" href="#shop">Explore the collection <ArrowRight size={17} /></a>
            <div className="store-social-proof"><div className="store-avatar-stack"><i>J</i><i>M</i><i>A</i></div><span><strong>Made for real life.</strong><br />Built as an original portfolio storefront</span></div>
          </div>
          <div className="store-hero-art" aria-label="Still life of curated home objects">
            <div className="hero-art-sun" /><div className="hero-art-arch" />
            <div className="hero-art-vase"><span /></div><div className="hero-art-book hero-art-book-one" /><div className="hero-art-book hero-art-book-two" />
            <div className="hero-art-branch"><i /><i /><i /><i /><i /></div>
            <div className="hero-art-label">OBJECTS TO KEEP<br /><small>EST. 2024 · MADE WITH INTENTION</small></div>
            <div className="hero-art-stamp">made<br />to last</div>
          </div>
          <div className="store-hero-index">01 <span /> 03</div>
        </section>

        <section className="store-values" id="story">
          <p>GOOD DESIGN, FEEL-GOOD LIVING.</p><span><i>✳</i> Made with care</span><span><i>✳</i> Built to last</span><span><i>✳</i> Ships with intention</span>
        </section>

        <section className="store-products" id="shop">
          <div className="store-section-heading"><div><span className="store-eyebrow"><span className="store-eyebrow-line" /> THE EDIT</span><h2>Useful things,<br className="mobile-break" /> <em>beautifully made.</em></h2></div><a href="#footer" className="store-text-link">Our approach <ArrowRight size={15} /></a></div>
          <div className="store-shop-controls">
            <div className="store-category-list" aria-label="Filter products by category">{categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
            <label className="store-search"><Search size={16} /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find something..." aria-label="Search products" /><kbd>/</kbd></label>
          </div>
          {productsLoading && <div className="store-catalog-state"><LoaderCircle className="spin" /><span>Loading the collection…</span></div>}
          {productsError && <div className="store-catalog-state store-catalog-error" role="alert"><CircleAlert /><span>{productsError}</span></div>}
          <div className="store-product-grid">
            {filtered.map((product, index) => <article className="store-product-card" key={product.id}>
              <button className={`store-product-art art-${product.color}`} disabled={!product.inStock} onClick={() => { updateQuantity(product.id, 1); showNotice(`${product.name} added to your bag`, 2500) }} aria-label={`Add ${product.name} to bag`}>
                <Badge className="store-product-tag">{product.inStock ? product.tag : 'Out of stock'}</Badge><ProductArt color={product.color} index={index} /><span className="store-quick-add"><Plus size={17} /> Quick add</span>
              </button>
              <div className="store-product-info"><div><h3>{product.name}</h3><span>{product.category}</span></div><strong>{money(product.priceCents)}</strong></div>
              <p className="store-product-description">{product.description}</p>
            </article>)}
            {!productsLoading && !productsError && !filtered.length && <div className="store-no-results">No pieces found. Try another search.</div>}
          </div>
          <button className="store-outline-button" onClick={() => { setCategory('All pieces'); setSearch('') }}>View the full collection <ArrowRight size={16} /></button>
        </section>

        <section className="store-note"><span>THE FIELDWORK NOTE</span><blockquote>“The best things in a home aren’t just useful. They remind you to slow down and enjoy being there.”</blockquote><p>— A note from our studio</p></section>

        <section className="store-newsletter"><div><span className="store-eyebrow"><span className="store-eyebrow-line" /> GOOD NOTES, OCCASIONALLY</span><h2>A little something<br /><em>for your inbox.</em></h2><p>New pieces, studio stories, and ideas for making the everyday better.</p></div><form onSubmit={(event) => { event.preventDefault(); showNotice('Demo form only. Your email was not saved.') }}><label htmlFor="store-email">Your email address</label><div><Input id="store-email" type="email" placeholder="you@example.com" required /><Button variant="ghost" size="icon" type="submit" aria-label="Join newsletter"><ArrowRight size={18} /></Button></div><small>Demo form only. Submissions are not stored or sent.</small></form></section>
      </main>

      <footer className="store-footer" id="footer"><a className="store-wordmark" href="#home">fieldwork<span>.</span></a><span>Useful things for everyday living.</span><div><a href="#shop">Shop</a>{auth.isAuthenticated ? <Link to="/account/orders">My orders</Link> : <button type="button" disabled={auth.isLoading} onClick={() => void requestSignIn('/account/orders')}>Customer sign in</button>}{auth.isAdmin ? <Link to="/admin/orders">Admin orders</Link> : <button type="button" disabled={auth.isLoading} onClick={() => void requestSignIn('/admin/orders')}>Admin sign in</button>}{auth.isAuthenticated && auth.isAdmin && cloudOpsUrl && <a href={cloudOpsUrl} target="_blank" rel="noreferrer">CloudOps dashboard</a>}</div><small>© 2026 Fieldwork Studio · Portfolio demonstration storefront</small></footer>

      {notice && <div role="status" className="store-toast"><Check size={17} />{notice}</div>}
      <ChatWidget />
      {cartOpen && <div className="store-drawer-backdrop" onClick={() => setCartOpen(false)}>
        <aside className="store-cart-drawer" onClick={(event) => event.stopPropagation()} aria-label="Shopping bag">
          <div className="store-drawer-header"><div><span className="store-eyebrow">YOUR BAG</span><h2>A few good things.</h2></div><button onClick={() => setCartOpen(false)} aria-label="Close bag"><X size={21} /></button></div>
          {!cartItems.length ? <div className="store-cart-empty"><ShoppingBag size={32} /><h3>Your bag is taking a breather.</h3><p>Find a useful thing or two for everyday living.</p><Button variant="brand" className="store-primary-button" onClick={() => { setCartOpen(false); document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' }) }}>Explore the collection <ArrowRight size={16} /></Button></div> : <>
            <div className="store-cart-items">{cartItems.map((product) => <div className="store-cart-item" key={product.id}><div className={`store-cart-thumb art-${product.color}`}><ProductArt color={product.color} index={products.indexOf(product)} /></div><div className="store-cart-item-info"><h3>{product.name}</h3><span>{money(product.priceCents)}</span><div className="store-quantity"><button onClick={() => updateQuantity(product.id, -1)} aria-label={`Remove one ${product.name}`}><Minus size={13} /></button><span>{cart[product.id]}</span><button onClick={() => updateQuantity(product.id, 1)} aria-label={`Add one ${product.name}`}><Plus size={13} /></button></div></div><strong>{money(product.priceCents * cart[product.id])}</strong></div>)}</div>
            <div className="store-shipping-details"><h3>Shipping address <span>Required before placing your order</span></h3><div className="store-address-form">
              <Input aria-label="Recipient name" placeholder="Recipient name" value={shippingAddress.recipientName || ''} onChange={(event) => updateAddress('recipientName', event.target.value)} />
              <Input aria-label="Address line 1" placeholder="Address line 1" value={shippingAddress.addressLine1 || ''} onChange={(event) => updateAddress('addressLine1', event.target.value)} />
              <Input aria-label="Address line 2" placeholder="Address line 2 (optional)" value={shippingAddress.addressLine2 || ''} onChange={(event) => updateAddress('addressLine2', event.target.value)} />
              <Input aria-label="City or locality" placeholder="City / locality" value={shippingAddress.locality || ''} onChange={(event) => updateAddress('locality', event.target.value)} />
              <Input aria-label="State or region" placeholder="State / region" value={shippingAddress.region || ''} onChange={(event) => updateAddress('region', event.target.value)} />
              <Input aria-label="Postal code" placeholder="Postal code" value={shippingAddress.postalCode || ''} onChange={(event) => updateAddress('postalCode', event.target.value)} />
              <Input aria-label="Country code" placeholder="Country code (US)" maxLength={2} value={shippingAddress.countryCode || ''} onChange={(event) => updateAddress('countryCode', event.target.value.toUpperCase())} />
            </div></div>
            <div className="store-cart-summary"><p><span>Subtotal</span><strong>{money(subtotal)}</strong></p><small>Payment is not part of this order request.</small><Button variant="brand" className="store-primary-button" disabled={checkoutBusy} onClick={() => void checkout()}>{checkoutBusy ? 'Submitting…' : auth.isAuthenticated ? 'Submit order request' : 'Sign in to submit'} <ArrowRight size={17} /></Button><div className="store-demo-callout"><ShieldCheck size={16} /> Stock changes only after admin acceptance.</div></div>
          </>}
        </aside>
      </div>}
    </div>
  )
}

function ProductArt({ color, index }: { color: string; index: number }) {
  return <span className={`product-illustration illustration-${index % 6} object-${color}`} aria-hidden="true"><i className="object-base" /><i className="object-shape" /><i className="object-detail" /><i className="object-shadow" /></span>
}

export default Store
