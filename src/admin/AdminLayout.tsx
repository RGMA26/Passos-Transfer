import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const links = [
  { to: '/admin', label: 'Início', end: true },
  { to: '/admin/motoristas', label: 'Motoristas', end: false },
  { to: '/admin/carros', label: 'Carros', end: false },
  { to: '/admin/transfers', label: 'Transfers', end: false },
  { to: '/admin/conferencia', label: 'Conferência', end: false },
  { to: '/admin/quinzenas', label: 'Quinzenas', end: false },
]

export default function AdminLayout() {
  const { signOut } = useAuth()
  return (
    <div className="admin-shell">
      <nav className="adminnav" aria-label="Navegação do administrador">
        <strong>Passos Transfer</strong>
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => (isActive ? 'navlink active' : 'navlink')}
          >
            {l.label}
          </NavLink>
        ))}
        <button type="button" className="link" onClick={() => void signOut()}>
          Sair
        </button>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
