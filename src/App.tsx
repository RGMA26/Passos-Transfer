import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import LoginPage from './auth/LoginPage'
import FirstAccessPage from './auth/FirstAccessPage'
import DriverLayout from './driver/DriverLayout'
import TransfersTab from './driver/TransfersTab'
import StatementTab from './driver/StatementTab'
import TodayTab from './driver/TodayTab'
import LaunchTab from './driver/LaunchTab'
import AdminLayout from './admin/AdminLayout'

function Placeholder({ title }: { title: string }) {
  return <h2>{title}</h2>
}

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
      </Route>
      <Route
        path="/admin"
        element={
          <Guard area="admin">
            <AdminLayout />
          </Guard>
        }
      >
        <Route index element={<Placeholder title="Início" />} />
        <Route path="motoristas" element={<Placeholder title="Motoristas" />} />
        <Route path="carros" element={<Placeholder title="Carros" />} />
        <Route path="transfers" element={<Placeholder title="Transfers" />} />
        <Route path="conferencia" element={<Placeholder title="Conferência" />} />
        <Route path="quinzenas" element={<Placeholder title="Quinzenas" />} />
        <Route path="extrato/:statementId" element={<Placeholder title="Extrato" />} />
      </Route>
      <Route path="*" element={<Entry />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
