import type { ReactNode } from 'react';
import { AlertTriangle, Inbox } from 'lucide-react';
import { describeError } from '../errors';
import { ApiError } from '@afb/api-client';
import { Button } from './Button';

/** Placeholder rows shown while data loads (announced as busy to assistive technology). */
export function LoadingState({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-16 animate-pulse rounded-[var(--radius-card)] bg-slate-200/70" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-500">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description !== undefined && <p className="mt-1 max-w-sm text-sm text-slate-600">{description}</p>}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A failed load, with the reason and a retry button. Shows the request id so a failure can be traced in the server log. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-[var(--radius-card)] border border-red-200 bg-red-50 px-6 py-8 text-center"
    >
      <AlertTriangle className="mb-2 h-6 w-6 text-red-600" aria-hidden="true" />
      <p className="text-sm font-medium text-red-800">{describeError(error)}</p>
      {requestId !== undefined && <p className="mt-1 text-xs text-red-700/80">Reference: {requestId}</p>}
      {onRetry !== undefined && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
