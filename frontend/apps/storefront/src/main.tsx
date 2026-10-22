import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { StoreAuthProvider } from './auth.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Missing storefront root element')

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <StoreAuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StoreAuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
