import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import UpdateBanner from './components/UpdateBanner'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import LoginPage from './auth/LoginPage'
import FirstAccessPage from './auth/FirstAccessPage'
import DriverLayout from './driver/DriverLayout'
import TransfersTab from './driver/TransfersTab'
import StatementTab from './driver/StatementTab'
import TodayTab from './driver/TodayTab'
import LaunchTab from './driver/LaunchTab'
import ShareTargetPage from './driver/ShareTargetPage'
import AdminLayout from './admin/AdminLayout'
import DriversPage from './admin/DriversPage'
import CarsPage from './admin/CarsPage'
import TransfersPage from './admin/TransfersPage'
import ReviewPage from './admin/ReviewPage'
import PeriodsPage from './admin/PeriodsPage'
import PrintStatementPage from './admin/PrintStatementPage'
import PrintReceiptPage from './admin/PrintReceiptPage'
import DashboardPage from './admin/DashboardPage'
import PendenciesPage from './admin/PendenciesPage'
import BalancePage from './admin/BalancePage'
import PrintBalancePage from './admin/PrintBalancePage'

const homeFor = (role: string) => (role === 'admin' ? '/admin' : '/m/hoje')

function Loading() {
  return <p className="loading">Carregando...</p>
}

export function Guard({ area, children }: { area: 'driver' | 'admin'; children: ReactNode }) {
  const { session, profile, loading } = useAuth()
  if (loading) return <Loading />
  if (!session || !profile) return <Navigate to="/login" replace />
  if (profile.must_change_password) return <Navigate to="/primeiro-acesso" replace />
  const own = profile.role === 'admin' ? 'admin' : 'driver'
  if (own !== area) return <Navigate to={homeFor(profile.role)} replace />
  return <>{children}</>
}

function Entry() {
  const { session, profile, loading } = useAuth()
  if (loading) return <Loading />
  if (!session || !profile) return <Navigate to="/login" replace />
  if (profile.must_change_password) return <Navigate to="/primeiro-acesso" replace />
  return <Navigate to={homeFor(profile.role)} replace />
}

function LoginRoute() {
  const { session, profile, loading } = useAuth()
  if (loading) return <Loading />
  if (session && profile) return <Entry />
  return <LoginPage />
}

function FirstAccessRoute() {
  const { session, profile, loading } = useAuth()
  if (loading) return <Loading />
  if (!session || !profile) return <Navigate to="/login" replace />
  if (!profile.must_change_password) return <Entry />
  return <FirstAccessPage />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/primeiro-acesso" element={<FirstAccessRoute />} />
      <Route
        path="/m"
        element={
          <Guard area="driver">
            <DriverLayout />
          </Guard>
        }
      >
        <Route index element={<Navigate to="hoje" replace />} />
        <Route path="hoje" element={<TodayTab />} />
        <Route path="lancar" element={<LaunchTab />} />
        <Route path="transfers" element={<TransfersTab />} />
        <Route path="extrato" element={<StatementTab />} />
        <Route path="compartilhar" element={<ShareTargetPage />} />
      </Route>
      <Route
        path="/admin"
        element={
          <Guard area="admin">
            <AdminLayout />
          </Guard>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="motoristas" element={<DriversPage />} />
        <Route path="carros" element={<CarsPage />} />
        <Route path="transfers" element={<TransfersPage />} />
        <Route path="conferencia" element={<ReviewPage />} />
        <Route path="quinzenas" element={<PeriodsPage />} />
        <Route path="pendencias" element={<PendenciesPage />} />
        <Route path="balanco" element={<BalancePage />} />
        <Route path="balanco/imprimir/:month" element={<PrintBalancePage />} />
        <Route path="extrato/:statementId" element={<PrintStatementPage />} />
        <Route path="recibo/:statementId" element={<PrintReceiptPage />} />
      </Route>
      <Route path="*" element={<Entry />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <UpdateBanner />
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
