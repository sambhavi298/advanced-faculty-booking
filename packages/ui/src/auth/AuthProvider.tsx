import { ApiError, type ApiClient } from '@afb/api-client';
import type { AuthUser, UserRole } from '@afb/types';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type SessionStatus = 'loading' | 'signed-in' | 'signed-out';

export interface AuthContextValue {
  status: SessionStatus;
  user: AuthUser | null;
  /** The portal this app serves; login refuses accounts of other roles. */
  role: UserRole;
  /** Set when the session ended on its own (token expired or account deactivated). */
  sessionExpired: boolean;
  api: ApiClient;
  login: (loginId: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Owns the portal's session. On start it restores a stored session with GET /auth/me; login stores the
 * JWT through the API client; a 401 on any later request (expired/revoked) signs the user out and
 * flags `sessionExpired` so the login page can explain why.
 */
export function AuthProvider({
  api,
  role,
  children,
}: {
  api: ApiClient;
  role: UserRole;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<SessionStatus>(() =>
    api.auth.isSignedIn() ? 'loading' : 'signed-out',
  );
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    if (status !== 'loading') {
      return undefined;
    }
    let current = true;
    api.auth.me().then(
      (me) => {
        if (!current) {
          return;
        }
        if (me.role === role) {
          setUser(me);
          setStatus('signed-in');
        } else {
          api.auth.logout();
          setStatus('signed-out');
        }
      },
      () => {
        if (current) {
          setStatus('signed-out');
        }
      },
    );
    return () => {
      current = false;
    };
    // Only the initial restore runs here; later sign-ins go through login().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () =>
      api.onSessionExpired(() => {
        setUser(null);
        setStatus('signed-out');
        setSessionExpired(true);
      }),
    [api],
  );

  const login = useCallback(
    async (loginId: string, password: string) => {
      const result = await api.auth.login({ loginId, password, role });
      setSessionExpired(false);
      setUser(result.user);
      setStatus('signed-in');
    },
    [api, role],
  );

  const logout = useCallback(() => {
    api.auth.logout();
    setUser(null);
    setSessionExpired(false);
    setStatus('signed-out');
  }, [api]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, role, sessionExpired, api, login, logout }),
    [status, user, role, sessionExpired, api, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}

/** The signed-in user, for pages rendered behind <RequireAuth>. */
export function useUser(): AuthUser {
  const { user } = useAuth();
  if (user === null) {
    throw new Error('useUser must be used behind <RequireAuth>');
  }
  return user;
}

export { ApiError };
