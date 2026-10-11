import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Store from './Store.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Missing storefront root element')

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <Store />
    </ErrorBoundary>
  </StrictMode>,
)
