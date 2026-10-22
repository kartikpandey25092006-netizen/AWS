import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, MessageCircle, Send, X } from 'lucide-react'
import { errorMessage, sendChatMessage } from './api'

type ChatEntry = { id: number; role: 'assistant' | 'user'; text: string }

const sessionStorageKey = 'fieldwork:chat-session-id'

function getSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(sessionStorageKey)
    if (existing && /^[a-zA-Z0-9._:-]{2,100}$/.test(existing)) return existing
    const created = window.crypto.randomUUID()
    window.sessionStorage.setItem(sessionStorageKey, created)
    return created
  } catch {
    return window.crypto.randomUUID()
  }
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [entries, setEntries] = useState<ChatEntry[]>([
    { id: 0, role: 'assistant', text: 'Hi! Ask me about products, sign-in help, or where to view your orders.' },
  ])
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [entries, busy, open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const message = draft.trim()
    if (!message || busy) return
    setDraft('')
    setBusy(true)
    setEntries((current) => [...current, { id: nextId.current++, role: 'user' as const, text: message }].slice(-30))
    try {
      const responses = await sendChatMessage(message, getSessionId())
      setEntries((current) => [...current, ...responses.map((text) => ({ id: nextId.current++, role: 'assistant' as const, text }))].slice(-30))
    } catch (error) {
      const fallback = errorMessage(error).includes('unavailable')
        ? 'Chat is temporarily unavailable. You can still use Customer sign in or My Orders on the storefront.'
        : 'I could not send that message. Please try again.'
      setEntries((current) => [...current, { id: nextId.current++, role: 'assistant' as const, text: fallback }].slice(-30))
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="store-chat-widget">
      {open && <section className="store-chat-panel" aria-label="Fieldwork customer help">
        <header className="store-chat-header">
          <div><span className="store-eyebrow">FIELDWORK HELP</span><strong>How can we help?</strong></div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close chat"><X size={18} /></button>
        </header>
        <div className="store-chat-messages" ref={listRef} role="log" aria-live="polite" aria-relevant="additions text">
          {entries.map((entry) => <div key={entry.id} className={`store-chat-message is-${entry.role}`}>{entry.text}</div>)}
          {busy && <div className="store-chat-typing" aria-label="Assistant is responding"><LoaderCircle size={15} className="store-chat-spinner" /> Thinking…</div>}
        </div>
        <form className="store-chat-form" onSubmit={(event) => void submit(event)}>
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask a question…"
            aria-label="Message Fieldwork help"
            maxLength={400}
            disabled={busy}
          />
          <button type="submit" aria-label="Send message" disabled={busy || !draft.trim()}><Send size={17} /></button>
        </form>
        <p className="store-chat-note">Please don’t send payment details or private order information.</p>
      </section>}
      <button className="store-chat-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={open ? 'Close help chat' : 'Open help chat'}>
        {open ? <X size={18} /> : <MessageCircle size={18} />}
        <span>{open ? 'Close' : 'Help'}</span>
      </button>
    </div>
  )
}
