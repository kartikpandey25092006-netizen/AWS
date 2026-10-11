import { useMemo, useState } from 'react'
import { ArrowRight, Check, Menu, Minus, Plus, Search, ShieldCheck, ShoppingBag, X } from 'lucide-react'
import { Button } from './components/ui/button'
import { Badge } from './components/ui/badge'
import { Input } from './components/ui/input'
import './store.css'

type Product = {
  id: string
  name: string
  category: string
  price: number
  description: string
  color: string
  tag: string
}

const products: Product[] = [
  { id: 'orbit-desk-lamp', name: 'Orbit Desk Lamp', category: 'Workspace', price: 68, description: 'A warm, focused glow for long nights and big ideas.', color: 'sand', tag: 'Bestseller' },
  { id: 'field-notes-set', name: 'Field Notes Set', category: 'Paper goods', price: 24, description: 'Three lay-flat notebooks, ready for whatever comes next.', color: 'sage', tag: 'Set of 3' },
  { id: 'everyday-tote', name: 'Everyday Carry Tote', category: 'Accessories', price: 42, description: 'Room for the daily essentials, made to go everywhere.', color: 'rose', tag: 'New' },
  { id: 'ceramic-pour-over', name: 'Ceramic Pour Over', category: 'Kitchen', price: 56, description: 'A quiet morning ritual in hand-finished stoneware.', color: 'blue', tag: 'Small batch' },
  { id: 'desktop-organizer', name: 'Modular Desk Tray', category: 'Workspace', price: 38, description: 'A place for the small things that keep a day moving.', color: 'clay', tag: 'Designed well' },
  { id: 'weekend-bottle', name: 'Weekend Bottle', category: 'Accessories', price: 32, description: 'A light, double-wall bottle for days outside the routine.', color: 'mint', tag: 'Everyday' },
]

const categories = ['All pieces', 'Workspace', 'Accessories', 'Kitchen', 'Paper goods']
const money = (amount: number) => `$${amount.toFixed(2)}`

const cloudOpsUrl = import.meta.env.VITE_CLOUDOPS_URL || 'http://localhost:5174/'

function Store() {
  const [category, setCategory] = useState('All pieces')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<Record<string, number>>({})
  const [cartOpen, setCartOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [notice, setNotice] = useState('')

  const filtered = useMemo(() => products.filter((product) =>
    (category === 'All pieces' || product.category === category) &&
    `${product.name} ${product.description} ${product.category}`.toLowerCase().includes(search.toLowerCase())
  ), [category, search])
  const cartItems = products.filter((product) => cart[product.id])
  const quantity = Object.values(cart).reduce((sum, count) => sum + count, 0)
  const subtotal = cartItems.reduce((sum, product) => sum + product.price * cart[product.id], 0)

  const updateQuantity = (id: string, amount: number) => {
    setCart((current) => {
      const next = { ...current, [id]: Math.max(0, (current[id] || 0) + amount) }
      if (!next[id]) delete next[id]
      return next
    })
  }

  const checkout = () => {
    if (!quantity) return
    setCart({})
    setCartOpen(false)
    setNotice('Demo order placed. No payment was collected.')
    window.setTimeout(() => setNotice(''), 4500)
  }

  return (
    <div className="store-shell">
      <div className="store-announcement">A little care goes a long way <span>Free shipping on demo orders over $75</span></div>
      <header className="store-header">
        <button className="store-mobile-toggle" onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle menu"><Menu size={20} /></button>
        <a className="store-wordmark" href="#home" aria-label="Fieldwork home">fieldwork<span>.</span></a>
        <nav className={mobileNav ? 'store-nav is-open' : 'store-nav'} aria-label="Main navigation">
          <a href="#shop" onClick={() => setMobileNav(false)}>Shop</a><a href="#story" onClick={() => setMobileNav(false)}>Our story</a>
          <a href="#footer" onClick={() => setMobileNav(false)}>Journal</a>
          <a className="store-nav-dashboard" href={cloudOpsUrl} target="_blank" rel="noreferrer">CloudOps dashboard <ArrowRight size={14} /></a>
        </nav>
        <div className="store-header-actions">
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
            <div className="store-social-proof"><div className="store-avatar-stack"><i>J</i><i>M</i><i>A</i></div><span><strong>Made for real life.</strong><br />Loved in 18,000+ homes</span></div>
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
          <div className="store-product-grid">
            {filtered.map((product, index) => <article className="store-product-card" key={product.id}>
              <button className={`store-product-art art-${product.color}`} onClick={() => { updateQuantity(product.id, 1); setNotice(`${product.name} added to your bag`); window.setTimeout(() => setNotice(''), 2500) }} aria-label={`Add ${product.name} to bag`}>
                <Badge className="store-product-tag">{product.tag}</Badge><ProductArt color={product.color} index={index} /><span className="store-quick-add"><Plus size={17} /> Quick add</span>
              </button>
              <div className="store-product-info"><div><h3>{product.name}</h3><span>{product.category}</span></div><strong>{money(product.price)}</strong></div>
              <p className="store-product-description">{product.description}</p>
            </article>)}
            {!filtered.length && <div className="store-no-results">No pieces found. Try another search.</div>}
          </div>
          <button className="store-outline-button" onClick={() => { setCategory('All pieces'); setSearch('') }}>View the full collection <ArrowRight size={16} /></button>
        </section>

        <section className="store-note"><span>THE FIELDWORK NOTE</span><blockquote>“The best things in a home aren’t just useful. They remind you to slow down and enjoy being there.”</blockquote><p>— A note from our studio</p></section>

        <section className="store-newsletter"><div><span className="store-eyebrow"><span className="store-eyebrow-line" /> GOOD NOTES, OCCASIONALLY</span><h2>A little something<br /><em>for your inbox.</em></h2><p>New pieces, studio stories, and ideas for making the everyday better.</p></div><form onSubmit={(event) => { event.preventDefault(); setNotice('Demo form only. Your email was not saved.'); window.setTimeout(() => setNotice(''), 3500) }}><label htmlFor="store-email">Your email address</label><div><Input id="store-email" type="email" placeholder="you@example.com" required /><Button variant="ghost" size="icon" type="submit" aria-label="Join newsletter"><ArrowRight size={18} /></Button></div><small>Demo form only. Submissions are not stored or sent.</small></form></section>
      </main>

      <footer className="store-footer" id="footer"><a className="store-wordmark" href="#home">fieldwork<span>.</span></a><span>Useful things for everyday living.</span><div><a href="#shop">Shop</a><a href="#story">Our story</a><a href={cloudOpsUrl} target="_blank" rel="noreferrer">CloudOps dashboard</a></div><small>© 2026 Fieldwork Studio · Portfolio demonstration storefront</small></footer>

      {notice && <div role="status" className="store-toast"><Check size={17} />{notice}</div>}
      {cartOpen && <div className="store-drawer-backdrop" onClick={() => setCartOpen(false)}>
        <aside className="store-cart-drawer" onClick={(event) => event.stopPropagation()} aria-label="Shopping bag">
          <div className="store-drawer-header"><div><span className="store-eyebrow">YOUR BAG</span><h2>A few good things.</h2></div><button onClick={() => setCartOpen(false)} aria-label="Close bag"><X size={21} /></button></div>
          {!cartItems.length ? <div className="store-cart-empty"><ShoppingBag size={32} /><h3>Your bag is taking a breather.</h3><p>Find a useful thing or two for everyday living.</p><Button variant="brand" className="store-primary-button" onClick={() => { setCartOpen(false); document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' }) }}>Explore the collection <ArrowRight size={16} /></Button></div> : <>
            <div className="store-cart-items">{cartItems.map((product) => <div className="store-cart-item" key={product.id}><div className={`store-cart-thumb art-${product.color}`}><ProductArt color={product.color} index={0} /></div><div className="store-cart-item-info"><h3>{product.name}</h3><span>{money(product.price)}</span><div className="store-quantity"><button onClick={() => updateQuantity(product.id, -1)} aria-label={`Remove one ${product.name}`}><Minus size={13} /></button><span>{cart[product.id]}</span><button onClick={() => updateQuantity(product.id, 1)} aria-label={`Add one ${product.name}`}><Plus size={13} /></button></div></div><strong>{money(product.price * cart[product.id])}</strong></div>)}</div>
            <div className="store-cart-summary"><p><span>Subtotal</span><strong>{money(subtotal)}</strong></p><small>Shipping and taxes are shown for demo purposes only.</small><Button variant="brand" className="store-primary-button" onClick={checkout}>Place demo order <ArrowRight size={17} /></Button><div className="store-demo-callout"><ShieldCheck size={16} /> Demo checkout only. No payment is collected.</div></div>
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
