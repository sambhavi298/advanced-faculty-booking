import { useCallback, useEffect, useState } from 'react';

export type AsyncState<T> =
  | { status: 'loading'; data: undefined; error: undefined }
  | { status: 'success'; data: T; error: undefined }
  | { status: 'error'; data: undefined; error: unknown };

const LOADING = { status: 'loading', data: undefined, error: undefined } as const;

/**
 * Runs an async loader whenever `deps` change and tracks loading / success / error.
 * `reload()` runs it again. A result is only shown if it belongs to the current deps, so a slow
 * response for an old search can never overwrite a newer one. `deps` must be primitives.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> & { reload: () => void } {
  const [version, setVersion] = useState(0);
  const key = JSON.stringify([...deps, version]);
  const [settled, setSettled] = useState<{ key: string; state: AsyncState<T> } | null>(null);

  useEffect(() => {
    let current = true;
    loader().then(
      (data) => {
        if (current) {
          setSettled({ key, state: { status: 'success', data, error: undefined } });
        }
      },
      (error: unknown) => {
        if (current) {
          setSettled({ key, state: { status: 'error', data: undefined, error } });
        }
      },
    );
    return () => {
      current = false;
    };
    // The loader is re-created on every render; `key` captures everything that should trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  const state: AsyncState<T> = settled !== null && settled.key === key ? settled.state : LOADING;
  return { ...state, reload };
}
