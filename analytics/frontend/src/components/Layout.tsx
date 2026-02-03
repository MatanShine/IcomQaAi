import { NavLink, Outlet } from 'react-router-dom';
import { ReactNode } from 'react';
import { useTheme } from '../hooks/useTheme';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/chat-history', label: 'Chat History' },
  { to: '/user-usage', label: 'User Usage' },
  { to: '/monitoring', label: 'Monitoring' },
  { to: '/comments', label: 'Comments' },
  { to: '/knowledge-base', label: 'Knowledge Base' },
  // { to: '/test-agent', label: 'Test Agent' },
];

export const Layout = ({ children }: { children?: ReactNode }) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex">
        {/* Sidebar */}
        <aside className="fixed left-0 top-0 h-screen w-64 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex h-full flex-col">
            {/* Logo/Brand */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <span className="text-lg font-semibold">Analytics</span>
              {/* Theme Toggle Switch */}
              <button
                onClick={toggleTheme}
                className="relative h-6 w-12 rounded-full bg-slate-300 shadow-sm transition-colors dark:bg-slate-700"
                aria-label="Toggle theme"
              >
                {/* Sun Icon (Light Mode) - Left side */}
                <div className="absolute left-1.5 top-1/2 -translate-y-1/2">
                  <svg
                    className="h-3.5 w-3.5 text-slate-700"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                    />
                  </svg>
                </div>
                {/* Moon Icon (Dark Mode) - Right side */}
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                  <svg
                    className="h-3.5 w-3.5 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                    />
                  </svg>
                </div>
                {/* Sliding Knob */}
                <div
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300 ease-in-out ${
                    theme === 'dark' ? 'translate-x-0.5' : 'translate-x-[22px]'
                  }`}
                />
              </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 space-y-1 px-3 py-4">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </aside>

        {/* Main Content */}
        <main className="ml-64 flex-1">
          <div className="mx-auto max-w-6xl px-6 py-8">
            {children ?? <Outlet />}
          </div>
        </main>
      </div>
    </div>
  );
};
