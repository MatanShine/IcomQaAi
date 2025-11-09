import { NavLink, Outlet } from 'react-router-dom';
import { ReactNode } from 'react';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/support-requests', label: 'Support Requests' },
];

export const Layout = ({ children }: { children?: ReactNode }) => {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold">Analytics</span>
          <nav className="flex gap-4">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `text-sm font-medium transition-colors ${isActive ? 'text-white' : 'text-slate-400 hover:text-white'}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        {children ?? <Outlet />}
      </main>
    </div>
  );
};
