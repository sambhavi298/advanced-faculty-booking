/**
 * Where a portal keeps its login token between page loads.
 *
 * Each portal runs on its own origin (and uses its own key), so the student, faculty and admin sessions
 * never interfere. If browser storage is unavailable (private mode, blocked site data) the store falls
 * back to memory: the user stays signed in until they close the tab instead of the app breaking.
 */
export interface TokenStore {
  /** The current token, or null if there is none or it has expired. */
  get(): string | null;
  set(token: string, expiresAt: string): void;
  clear(): void;
}

interface StoredToken {
  token: string;
  expiresAt: string;
}

export function createTokenStore(key: string, storage?: Storage, now: () => number = Date.now): TokenStore {
  let memory: StoredToken | null = null;

  const read = (): StoredToken | null => {
    if (storage !== undefined) {
      try {
        const raw = storage.getItem(key);
        return raw === null ? null : (JSON.parse(raw) as StoredToken);
      } catch {
        // Unavailable or corrupted storage: fall through to memory.
      }
    }
    return memory;
  };

  return {
    get() {
      const stored = read();
      if (stored === null || typeof stored.token !== 'string' || !(Date.parse(stored.expiresAt) > now())) {
        return null;
      }
      return stored.token;
    },
    set(token, expiresAt) {
      memory = { token, expiresAt };
      try {
        storage?.setItem(key, JSON.stringify(memory));
      } catch {
        // Keep the in-memory copy only.
      }
    },
    clear() {
      memory = null;
      try {
        storage?.removeItem(key);
      } catch {
        // Nothing stored that could be removed.
      }
    },
  };
}
