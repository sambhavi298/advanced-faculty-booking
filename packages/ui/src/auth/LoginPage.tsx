import { ApiError } from '@afb/api-client';
import { useState, type SyntheticEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Button } from '../components/Button';
import { Field, Input } from '../components/Form';
import { describeError } from '../errors';
import { useAuth } from './AuthProvider';

export interface LoginPageProps {
  /** "Student", "Faculty", "Admin" */
  portalName: string;
  /** Label of the login-id field: "Registration Number", "Employee ID", "Admin ID". */
  idLabel: string;
  idPlaceholder: string;
}

/** The sign-in screen shared by all three portals (only labels differ). */
export function LoginPage({ portalName, idLabel, idPlaceholder }: LoginPageProps) {
  const { status, login, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ loginId?: string; password?: string; form?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  const returnTo = (location.state as { from?: string } | null)?.from ?? '/';
  if (status === 'signed-in') {
    return <Navigate to={returnTo} replace />;
  }

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: typeof errors = {};
    if (loginId.trim() === '') {
      found.loginId = `Enter your ${idLabel}.`;
    }
    if (password === '') {
      found.password = 'Enter your password.';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    setSubmitting(true);
    try {
      await login(loginId.trim(), password);
      void navigate(returnTo, { replace: true });
    } catch (error) {
      const fields = error instanceof ApiError ? error.fieldErrors : {};
      setErrors({ loginId: fields.loginId, password: fields.password, form: describeError(error) });
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-b from-brand-950 to-brand-800 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <p className="text-sm font-medium tracking-wide text-brand-200 uppercase">
            SRM Faculty Appointments
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{portalName} Portal</h1>
        </div>
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          className="space-y-4 rounded-2xl bg-white p-6 shadow-xl"
        >
          {sessionExpired && (
            <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Your session has ended. Please sign in again.
            </p>
          )}
          {errors.form !== undefined && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {errors.form}
            </p>
          )}
          <Field label={idLabel} htmlFor="loginId" error={errors.loginId}>
            <Input
              id="loginId"
              name="loginId"
              autoComplete="username"
              placeholder={idPlaceholder}
              value={loginId}
              invalid={errors.loginId !== undefined}
              onChange={(event) => {
                setLoginId(event.target.value);
              }}
            />
          </Field>
          <Field label="Password" htmlFor="password" error={errors.password}>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              invalid={errors.password !== undefined}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          </Field>
          <Button type="submit" className="w-full" loading={submitting}>
            Sign in
          </Button>
        </form>
      </div>
    </main>
  );
}
