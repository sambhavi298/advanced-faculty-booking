import { CalendarClock, LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { cn } from '../cn';
import { NotificationBell } from './NotificationBell';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Match only the exact path (for "/"). */
  end?: boolean;
}

const PORTAL_TAGS: Record<string, string> = {
  Student: 'bg-sky-100 text-sky-800',
  Faculty: 'bg-emerald-100 text-emerald-800',
  Admin: 'bg-violet-100 text-violet-800',
};

/** The frame of every signed-in page: brand, portal tag, navigation, notifications and the user menu. */
export function AppShell({
  portalName,
  nav,
  wide = false,
  children,
}: {
  portalName: 'Student' | 'Faculty' | 'Admin';
  nav: NavItem[];
  /** A wider page for data-heavy portals (admin tables). */
  wide?: boolean;
  children: ReactNode;
}) {
  const { user, logout } = useAuth();
  // Tailwind only generates classes it can see written in full, so each variant is spelled out.
  const layout = wide
    ? {
        width: 'max-w-7xl',
        desktopNav: 'xl:flex',
        mobileNav: 'xl:hidden',
        userBlock: 'hidden 2xl:block',
        signOutText: 'hidden 2xl:inline',
      }
    : {
        width: 'max-w-6xl',
        desktopNav: 'lg:flex',
        mobileNav: 'lg:hidden',
        userBlock: 'hidden sm:block',
        signOutText: 'hidden sm:inline',
      };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className={cn('mx-auto flex h-16 items-center gap-4 px-4', layout.width)}>
          <div className="flex shrink-0 items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-700 text-white">
              <CalendarClock className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold whitespace-nowrap text-slate-900">
                SRM Faculty Appointments
              </p>
              <span
                className={cn(
                  'inline-block rounded px-1.5 text-[11px] font-semibold uppercase tracking-wide',
                  PORTAL_TAGS[portalName],
                )}
              >
                {portalName} portal
              </span>
            </div>
          </div>
          <nav aria-label="Main" className={cn('ml-4 hidden gap-1', layout.desktopNav)}>
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end ?? false}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium whitespace-nowrap',
                    isActive
                      ? 'bg-brand-50 text-brand-800'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  )
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <div className={cn('text-right', layout.userBlock)}>
              <p className="text-sm font-medium text-slate-900">{user?.fullName}</p>
              <p className="text-xs text-slate-500">{user?.loginId}</p>
            </div>
            <button
              type="button"
              onClick={logout}
              aria-label="Sign out"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm whitespace-nowrap text-slate-600 hover:bg-slate-100"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className={layout.signOutText}>Sign out</span>
            </button>
          </div>
        </div>
        <nav
          aria-label="Main (mobile)"
          className={cn('flex gap-1 overflow-x-auto border-t border-slate-100 px-2 py-1.5', layout.mobileNav)}
        >
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? false}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm',
                  isActive ? 'bg-brand-50 font-medium text-brand-800' : 'text-slate-600',
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className={cn('mx-auto px-4 py-8', layout.width)}>{children}</main>
    </div>
  );
}
