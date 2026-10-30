import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import SyncBadge from '../components/SyncBadge'

const tabs = [
  { to: '/m/hoje', label: 'Hoje' },
  { to: '/m/lancar', label: 'Lançar' },
  { to: '/m/transfers', label: 'Transfers' },
  { to: '/m/extrato', label: 'Extrato' },
]

export default function DriverLayout() {
  const { signOut } = useAuth()
  return (
    <div className="driver-shell">
      <header className="topbar">
        <strong>Passos Transfer</strong>
        <button type="button" className="link" onClick={() => void signOut()}>
          Sair
        </button>
      </header>
      <SyncBadge />
      <main className="content">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Navegação do motorista">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
