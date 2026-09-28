import type { LoginResponse } from '@afb/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client';
import { ApiError } from '../src/errors';
import { createTokenStore } from '../src/token-store';
import { json, MemoryStorage, startFakeApi } from './support';

const LOGIN: LoginResponse = {
  token: 'header.payload.signature',
  expiresAt: '2099-01-01T00:00:00.000Z',
  user: { id: 1, loginId: 'ADMIN001', fullName: 'Amy', role: 'ADMIN' },
};

let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup(handler: Parameters<typeof startFakeApi>[0]) {
  const api = await startFakeApi(handler);
  close = api.close;
  const tokenStore = createTokenStore('afb.test', new MemoryStorage());
  const onSessionExpired = vi.fn();
  const client = createApiClient({ baseURL: api.baseURL, tokenStore, onSessionExpired });
  return { client, api, tokenStore, onSessionExpired };
}

describe('createApiClient', () => {
  it('stores the token after login and sends it as a Bearer token afterwards', async () => {
    const { client, api } = await setup((req, res) => {
      if (req.url === '/api/auth/login') {
        json(res, 200, LOGIN);
      } else {
        json(res, 200, LOGIN.user);
      }
    });

    expect(client.auth.isSignedIn()).toBe(false);
    await expect(
      client.auth.login({ loginId: 'ADMIN001', password: 'Admin123!', role: 'ADMIN' }),
    ).resolves.toEqual(LOGIN);
    expect(client.auth.isSignedIn()).toBe(true);
    await expect(client.auth.me()).resolves.toEqual(LOGIN.user);

    expect(api.requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/auth/login',
      authorization: undefined,
      body: { loginId: 'ADMIN001', password: 'Admin123!', role: 'ADMIN' },
    });
    expect(api.requests[1]).toMatchObject({
      method: 'GET',
      url: '/api/auth/me',
      authorization: 'Bearer header.payload.signature',
    });
  });

  it('rejects failed logins with a typed ApiError and does not treat them as an expired session', async () => {
    const { client, onSessionExpired } = await setup((_req, res) => {
      json(res, 401, {
        error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect login ID or password.', requestId: 'r' },
      });
    });

    const error: unknown = await client.auth
      .login({ loginId: 'X', password: 'y' })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Incorrect login ID or password.',
    });
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('clears the token and reports an expired session when an authenticated request gets 401', async () => {
    const { client, tokenStore, onSessionExpired } = await setup((_req, res) => {
      json(res, 401, {
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Your session has expired. Please log in again.',
          requestId: 'r',
        },
      });
    });
    tokenStore.set('stale', '2099-01-01T00:00:00.000Z');

    await expect(client.auth.me()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    expect(tokenStore.get()).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
  });

  it('notifies subscribed listeners of session expiry until they unsubscribe', async () => {
    const { client, tokenStore } = await setup((_req, res) => {
      json(res, 401, { error: { code: 'UNAUTHENTICATED', message: 'expired', requestId: 'r' } });
    });
    const listener = vi.fn();
    const unsubscribe = client.onSessionExpired(listener);

    tokenStore.set('t', '2099-01-01T00:00:00.000Z');
    await client.auth.me().catch(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    tokenStore.set('t', '2099-01-01T00:00:00.000Z');
    await client.auth.me().catch(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('passes other errors through unchanged', async () => {
    const { client, tokenStore, onSessionExpired } = await setup((_req, res) => {
      json(res, 403, { error: { code: 'FORBIDDEN', message: 'No.', requestId: 'r' } });
    });
    tokenStore.set('valid', '2099-01-01T00:00:00.000Z');

    await expect(client.auth.me()).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(tokenStore.get()).toBe('valid');
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('reports an unreachable server as NETWORK_ERROR', async () => {
    const { client, api } = await setup((_req, res) => {
      json(res, 200, {});
    });
    await api.close();
    close = undefined;

    await expect(client.health.live()).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('works without an onSessionExpired callback', async () => {
    const api = await startFakeApi((_req, res) => {
      json(res, 401, { error: { code: 'UNAUTHENTICATED', message: 'expired', requestId: 'r' } });
    });
    close = api.close;
    const tokenStore = createTokenStore('k');
    tokenStore.set('t', '2099-01-01T00:00:00.000Z');
    const client = createApiClient({ baseURL: api.baseURL, tokenStore });

    await expect(client.auth.me()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(tokenStore.get()).toBeNull();
  });

  it('calls the health endpoints', async () => {
    const { client } = await setup((req, res) => {
      json(res, 200, req.url === '/api/health' ? { status: 'ok' } : { status: 'ready' });
    });
    await expect(client.health.live()).resolves.toEqual({ status: 'ok' });
    await expect(client.health.ready()).resolves.toEqual({ status: 'ready' });
  });

  it('signs out by forgetting the token', async () => {
    const { client, tokenStore } = await setup((_req, res) => {
      json(res, 200, LOGIN);
    });
    await client.auth.login({ loginId: 'ADMIN001', password: 'Admin123!' });
    client.auth.logout();
    expect(tokenStore.get()).toBeNull();
    expect(client.auth.isSignedIn()).toBe(false);
  });

  it("defaults to '/api' and a 15-second timeout", () => {
    const client = createApiClient({ tokenStore: createTokenStore('k') });
    expect(client.http.defaults.baseURL).toBe('/api');
    expect(client.http.defaults.timeout).toBe(15_000);
  });
});
