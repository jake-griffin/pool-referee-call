/**
 * Tests for the referee push subscription routes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionPayload } from '@/lib/auth/session';

vi.mock('@/lib/db/queries', () => ({
  putPushSubscription: vi.fn(),
  deletePushSubscription: vi.fn(),
  pushSubIdFromEndpoint: vi.fn((endpoint: string) => `hash(${endpoint})`),
}));

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    getSession: vi.fn(),
    requireSession: vi.fn(),
  };
});

import {
  putPushSubscription,
  deletePushSubscription,
} from '@/lib/db/queries';
import { getSession, requireSession, AuthError } from '@/lib/auth/session';
import {
  POST as subscribePost,
  DELETE as subscribeDelete,
} from '@/app/api/tournaments/[id]/push/subscribe/route';

const routeParams = { params: Promise.resolve({ id: 't_1' }) };

function req(method: string, body?: unknown): Request {
  const init: RequestInit = { method, headers: new Headers() };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Headers).set('content-type', 'application/json');
  }
  return new Request('http://localhost:3000/test', init);
}

function refSession(): SessionPayload {
  return {
    sessionId: 's1',
    tournamentId: 't_1',
    role: 'referee',
    entityId: 'ref_1',
    displayName: 'Alice',
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
}

const validSub = {
  endpoint: 'https://push.example/ep/1',
  keys: { p256dh: 'p256', auth: 'authkey' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/tournaments/[id]/push/subscribe', () => {
  it('returns 401 when not a referee session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(requireSession).mockImplementation(() => {
      throw new AuthError('Your session has expired — please rejoin using your link.', 401);
    });

    const res = await subscribePost(req('POST', validSub), routeParams);
    expect(res.status).toBe(401);
  });

  it('returns 400 when the subscription is missing keys', async () => {
    vi.mocked(getSession).mockResolvedValue(refSession());
    vi.mocked(requireSession).mockImplementation(() => {});

    const res = await subscribePost(
      req('POST', { endpoint: 'https://push.example/ep/1' }),
      routeParams,
    );
    expect(res.status).toBe(400);
    expect(putPushSubscription).not.toHaveBeenCalled();
  });

  it('stores the subscription tied to the referee and returns 201', async () => {
    vi.mocked(getSession).mockResolvedValue(refSession());
    vi.mocked(requireSession).mockImplementation(() => {});
    vi.mocked(putPushSubscription).mockResolvedValue(undefined);

    const res = await subscribePost(req('POST', validSub), routeParams);
    expect(res.status).toBe(201);

    const stored = vi.mocked(putPushSubscription).mock.calls[0][0];
    expect(stored.tournamentId).toBe('t_1');
    expect(stored.refereeId).toBe('ref_1');
    expect(stored.endpoint).toBe(validSub.endpoint);
    expect(stored.keys).toEqual(validSub.keys);
    expect(stored.subId).toBe(`hash(${validSub.endpoint})`);
  });
});

describe('DELETE /api/tournaments/[id]/push/subscribe', () => {
  it('returns 400 without an endpoint', async () => {
    vi.mocked(getSession).mockResolvedValue(refSession());
    vi.mocked(requireSession).mockImplementation(() => {});

    const res = await subscribeDelete(req('DELETE', {}), routeParams);
    expect(res.status).toBe(400);
  });

  it('deletes the subscription by endpoint hash', async () => {
    vi.mocked(getSession).mockResolvedValue(refSession());
    vi.mocked(requireSession).mockImplementation(() => {});
    vi.mocked(deletePushSubscription).mockResolvedValue(undefined);

    const res = await subscribeDelete(
      req('DELETE', { endpoint: validSub.endpoint }),
      routeParams,
    );
    expect(res.status).toBe(200);
    expect(deletePushSubscription).toHaveBeenCalledWith('t_1', `hash(${validSub.endpoint})`);
  });
});
