'use client';

import { useState, useEffect, useCallback } from 'react';

interface EnableNotificationsProps {
  tournamentId: string;
}

/** Base64url VAPID public key → ArrayBuffer for PushManager.subscribe. */
function urlBase64ToApplicationServerKey(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

type Status = 'unsupported' | 'default' | 'granted' | 'denied' | 'subscribing' | 'error';

/**
 * Referee-facing control to enable OS-level push notifications for new calls.
 * Registers the service worker, requests permission, subscribes via the Push
 * API, and stores the subscription on the server.
 */
export default function EnableNotifications({ tournamentId }: EnableNotificationsProps) {
  const [status, setStatus] = useState<Status>('default');
  const [subscribed, setSubscribed] = useState(false);
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  useEffect(() => {
    if (!supported) {
      setStatus('unsupported');
      return;
    }
    setStatus(Notification.permission as Status);
    // Reflect an existing subscription if present.
    navigator.serviceWorker.getRegistration().then((reg) => {
      reg?.pushManager.getSubscription().then((sub) => {
        if (sub) setSubscribed(true);
      });
    });
  }, [supported]);

  const enable = useCallback(async () => {
    if (!supported || !vapidKey) {
      setStatus('error');
      return;
    }
    setStatus('subscribing');
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission as Status);
        return;
      }

      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToApplicationServerKey(vapidKey),
        }));

      const json = subscription.toJSON();
      const res = await fetch(`/api/tournaments/${tournamentId}/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });

      if (!res.ok) {
        setStatus('error');
        return;
      }
      setSubscribed(true);
      setStatus('granted');
    } catch {
      setStatus('error');
    }
  }, [supported, vapidKey, tournamentId]);

  // Don't render anything if the feature isn't configured on the server.
  if (!vapidKey) return null;

  if (status === 'unsupported') {
    return (
      <div className="px-4 py-2 text-xs text-gray-500">
        Notifications aren&apos;t supported on this browser. On iPhone, add this
        page to your Home Screen first, then enable notifications.
      </div>
    );
  }

  if (subscribed && status === 'granted') {
    return (
      <div className="px-4 py-2 text-xs text-green-700">
        🔔 Notifications on — you&apos;ll be alerted when a call comes in.
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className="px-4 py-2 text-xs text-amber-700">
        Notifications are blocked. Enable them in your browser settings to get
        call alerts.
      </div>
    );
  }

  return (
    <div className="px-4 py-2">
      <button
        type="button"
        onClick={enable}
        disabled={status === 'subscribing'}
        className="min-h-[36px] rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {status === 'subscribing' ? 'Enabling…' : '🔔 Enable call notifications'}
      </button>
      {status === 'error' && (
        <p className="mt-1 text-xs text-red-600">
          Couldn&apos;t enable notifications. Please try again.
        </p>
      )}
    </div>
  );
}
