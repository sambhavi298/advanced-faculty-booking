import { createApiClient, createTokenStore } from '@afb/api-client';

/** localStorage, or undefined where the browser blocks it (the token then lives in memory for the tab). */
export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const api = createApiClient({ tokenStore: createTokenStore('afb.faculty.session', browserStorage()) });
