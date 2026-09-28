import { ApiError } from '@afb/api-client';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthProvider, useAuth, useUser } from '../src/auth/AuthProvider';
import { LoginPage } from '../src/auth/LoginPage';
import { RequireAuth } from '../src/auth/RequireAuth';
import { fakeApi, STUDENT } from './fixtures';

function Home() {
  const user = useUser();
  const { logout } = useAuth();
  return (
    <div>
      <p>Welcome {user.fullName}</p>
      <button type="button" onClick={logout}>
        Log out
      </button>
    </div>
  );
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderPortal(api: ReturnType<typeof fakeApi>, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider api={api.client} role="STUDENT">
        <Routes>
          <Route
            path="/login"
            element={<LoginPage portalName="Student" idLabel="Registration Number" idPlaceholder="RA…" />}
          />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <Home />
              </RequireAuth>
            }
          />
        </Routes>
        <Where />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AuthProvider + RequireAuth', () => {
  it('sends a visitor without a session to the login page, remembering where they were going', () => {
    const api = fakeApi(false);
    renderPortal(api, '/appointments?status=PENDING');
    expect(screen.getByRole('heading', { name: 'Student Portal' })).toBeInTheDocument();
    expect(api.api.auth.me).not.toHaveBeenCalled();
  });

  it('restores a stored session with GET /auth/me', async () => {
    const api = fakeApi(true);
    api.api.auth.me.mockResolvedValue(STUDENT);
    renderPortal(api);
    expect(screen.getByRole('status', { name: 'Restoring your session' })).toBeInTheDocument();
    expect(await screen.findByText('Welcome Priya Sharma')).toBeInTheDocument();
  });

  it('drops a stored session that belongs to another portal', async () => {
    const api = fakeApi(true);
    api.api.auth.me.mockResolvedValue({ ...STUDENT, role: 'FACULTY' });
    renderPortal(api);
    expect(await screen.findByRole('heading', { name: 'Student Portal' })).toBeInTheDocument();
    expect(api.api.auth.logout).toHaveBeenCalled();
  });

  it('treats a failed restore as signed out', async () => {
    const api = fakeApi(true);
    api.api.auth.me.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'expired'));
    renderPortal(api);
    expect(await screen.findByRole('heading', { name: 'Student Portal' })).toBeInTheDocument();
  });

  it('ignores a restore that finishes after the portal unmounted', async () => {
    const api = fakeApi(true);
    let resolve: (value: typeof STUDENT) => void = () => undefined;
    let reject: (reason: unknown) => void = () => undefined;
    api.api.auth.me
      .mockReturnValueOnce(new Promise((ok) => (resolve = ok)))
      .mockReturnValueOnce(new Promise((_, fail) => (reject = fail)));
    renderPortal(api).unmount();
    renderPortal(api).unmount();
    await act(async () => {
      resolve(STUDENT);
      reject(new Error('late'));
      await Promise.resolve();
    });
    expect(api.api.auth.logout).not.toHaveBeenCalled();
  });

  it('signs out when the API reports the session expired, and explains why on the login page', async () => {
    const api = fakeApi(true);
    api.api.auth.me.mockResolvedValue(STUDENT);
    renderPortal(api);
    await screen.findByText('Welcome Priya Sharma');
    act(() => {
      api.expire();
    });
    expect(await screen.findByText('Your session has ended. Please sign in again.')).toBeInTheDocument();
  });

  it('logs out on request', async () => {
    const api = fakeApi(true);
    api.api.auth.me.mockResolvedValue(STUDENT);
    renderPortal(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(api.api.auth.logout).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Student Portal' })).toBeInTheDocument();
  });

  it('refuses hooks used outside their providers', () => {
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used inside <AuthProvider>');
    const api = fakeApi(false);
    expect(() =>
      renderHook(() => useUser(), {
        wrapper: ({ children }) => (
          <AuthProvider api={api.client} role="STUDENT">
            {children}
          </AuthProvider>
        ),
      }),
    ).toThrow('useUser must be used behind <RequireAuth>');
  });
});

describe('LoginPage', () => {
  it('validates both fields before calling the API', async () => {
    const api = fakeApi(false);
    renderPortal(api, '/login');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your Registration Number.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(api.api.auth.login).not.toHaveBeenCalled();
  });

  it('signs in with the trimmed login ID and returns to the page the user wanted', async () => {
    const api = fakeApi(false);
    api.api.auth.login.mockResolvedValue({ token: 't', expiresAt: '2030-01-01T00:00:00Z', user: STUDENT });
    renderPortal(api, '/appointments?status=PENDING');
    await userEvent.type(screen.getByLabelText('Registration Number'), '  RA221100301001 ');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123!');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Welcome Priya Sharma')).toBeInTheDocument();
    expect(api.api.auth.login).toHaveBeenCalledWith({
      loginId: 'RA221100301001',
      password: 'Password123!',
      role: 'STUDENT',
    });
    expect(screen.getByTestId('where')).toHaveTextContent('/appointments?status=PENDING');
  });

  it('shows the server message and field errors when sign-in fails', async () => {
    const api = fakeApi(false);
    api.api.auth.login.mockRejectedValueOnce(
      new ApiError(403, 'WRONG_PORTAL', 'This account belongs to the Faculty portal.'),
    );
    api.api.auth.login.mockRejectedValueOnce(
      new ApiError(400, 'VALIDATION_ERROR', 'Invalid request.', {
        issues: [{ field: 'loginId', message: 'Too long.' }],
      }),
    );
    renderPortal(api, '/login');
    await userEvent.type(screen.getByLabelText('Registration Number'), 'FAC200');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123!');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This account belongs to the Faculty portal.');

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Too long.')).toBeInTheDocument();
    expect(screen.getByLabelText('Registration Number')).toHaveAttribute('aria-invalid', 'true');
  });

  it('describes non-API failures too', async () => {
    const api = fakeApi(false);
    api.api.auth.login.mockRejectedValue(new Error('boom'));
    renderPortal(api, '/login');
    await userEvent.type(screen.getByLabelText('Registration Number'), 'RA1');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('sends an already signed-in user straight to the portal', async () => {
    const api = fakeApi(true);
    api.api.auth.me.mockResolvedValue(STUDENT);
    renderPortal(api, '/login');
    await waitFor(() => {
      expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
    });
    expect(screen.getByText('Welcome Priya Sharma')).toBeInTheDocument();
  });
});
