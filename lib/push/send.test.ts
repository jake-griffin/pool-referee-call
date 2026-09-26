/**
 * Unit tests for the Web Push send helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PushSubscriptionRecord } from '@/lib/db/queries';

// Mock web-push
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

// Mock the DB delete used for pruning
vi.mock('@/lib/db/queries', () => ({
  deletePushSubscription: vi.fn(),
}));

import webpush from 'web-push';
import { deletePushSubscription } from '@/lib/db/queries';
import { sendToSubscriptions, isPushConfigured } from '@/lib/push/send';

function sub(overrides?: Partial<PushSubscriptionRecord>): PushSubscriptionRecord {
  return {
    subId: 'sub-1',
    tournamentId: 't_1',
    refereeId: 'ref_1',
    endpoint: 'https://push.example/ep/1',
    keys: { p256dh: 'p', auth: 'a' },
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
});

describe('isPushConfigured', () => {
  it('is false when VAPID keys are missing', () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    expect(isPushConfigured()).toBe(false);
  });

  it('is true when VAPID keys are present', () => {
    expect(isPushConfigured()).toBe(true);
  });
});

describe('sendToSubscriptions', () => {
  it('is a no-op when push is not configured', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const result = await sendToSubscriptions([sub()], { title: 't', body: 'b' });
    expect(result).toEqual({ sent: 0, pruned: 0, failed: 0 });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('sends to every subscription and counts successes', async () => {
    vi.mocked(webpush.sendNotification).mockResolvedValue(undefined as never);

    const result = await sendToSubscriptions(
      [sub({ subId: 's1' }), sub({ subId: 's2', endpoint: 'https://push.example/ep/2' })],
      { title: 'New call', body: 'Table 3', url: '/t/t_1/referee', tag: 'call-t_1' },
    );

    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    expect(result.sent).toBe(2);
    expect(result.pruned).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('prunes subscriptions that return 410 Gone', async () => {
    const gone = Object.assign(new Error('gone'), { statusCode: 410 });
    vi.mocked(webpush.sendNotification)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(gone);

    const result = await sendToSubscriptions(
      [
        sub({ subId: 's1', endpoint: 'https://push.example/ep/1' }),
        sub({ subId: 's2', endpoint: 'https://push.example/ep/2' }),
      ],
      { title: 't', body: 'b' },
    );

    expect(result.sent).toBe(1);
    expect(result.pruned).toBe(1);
    expect(deletePushSubscription).toHaveBeenCalledWith('t_1', 's2');
  });

  it('counts other failures without pruning', async () => {
    const boom = Object.assign(new Error('server error'), { statusCode: 500 });
    vi.mocked(webpush.sendNotification).mockRejectedValue(boom);

    const result = await sendToSubscriptions([sub()], { title: 't', body: 'b' });
    expect(result.failed).toBe(1);
    expect(result.pruned).toBe(0);
    expect(deletePushSubscription).not.toHaveBeenCalled();
  });
});
