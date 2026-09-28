import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Spinner } from '../components/Spinner';
import { useAuth } from './AuthProvider';

/** Renders children only for a signed-in user; otherwise redirects to /login and remembers where to return. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div
        role="status"
        aria-label="Restoring your session"
        className="grid min-h-screen place-items-center text-brand-600"
      >
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  if (status === 'signed-out') {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <>{children}</>;
}
