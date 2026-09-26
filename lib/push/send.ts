/**
 * lib/push/send.ts
 *
 * Server-side Web Push sending, using VAPID. Fans out a notification payload to
 * a set of subscriptions and prunes any that the push service reports as gone
 * (HTTP 404/410), so dead subscriptions don't accumulate.
 *
 * VAPID configuration comes from env:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 * If these are unset, push is treated as disabled and sends become no-ops
 * (so the app still runs without notifications configured).
 */

import webpush from 'web-push';
import {
  deletePushSubscription,
  type PushSubscriptionRecord,
} from '@/lib/db/queries';

export type PushPayload = {
  title: string;
  body: string;
  /** URL to open when the notification is clicked. */
  url?: string;
  /** Notification tag — same tag coalesces/replaces prior notifications. */
  tag?: string;
};

let configured = false;

/**
 * Returns true if VAPID keys are configured. Lazily initializes web-push.
 */
export function isPushConfigured(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

  if (!publicKey || !privateKey) return false;

  if (!configured) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  }
  return true;
}

/**
 * Sends a payload to every given subscription in parallel. Subscriptions the
 * push service reports as gone (404/410) are deleted. Never throws — individual
 * send failures are swallowed so a bad subscription can't break the caller.
 *
 * Returns a small summary useful for logging/tests.
 */
export async function sendToSubscriptions(
  subscriptions: PushSubscriptionRecord[],
  payload: PushPayload,
): Promise<{ sent: number; pruned: number; failed: number }> {
  if (!isPushConfigured() || subscriptions.length === 0) {
    return { sent: 0, pruned: 0, failed: 0 };
  }

  const body = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
          },
          body,
        );
        sent++;
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription is gone — remove it so we stop trying.
          pruned++;
          try {
            await deletePushSubscription(sub.tournamentId, sub.subId);
          } catch {
            // best-effort cleanup
          }
        } else {
          failed++;
        }
      }
    }),
  );

  return { sent, pruned, failed };
}
