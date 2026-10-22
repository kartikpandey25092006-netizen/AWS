import { Navigate, Route, Routes } from 'react-router-dom'
import Store from './Store'
import { AdminOrdersPage, CustomerOrdersPage } from './OrderPages'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Store />} />
      <Route path="/account/orders" element={<CustomerOrdersPage />} />
      <Route path="/admin/orders" element={<AdminOrdersPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
