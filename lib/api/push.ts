import { apiFetch } from '@/lib/api/client';
import { isApiConfigured } from '@/lib/api/config';

export async function registerPushToken(token: string): Promise<void> {
  if (!isApiConfigured()) return;

  await apiFetch('/register-push-token', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export interface PushNotificationPayload {
  recipientUserId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushSendResult {
  sent: number;
  reason?: string;
}

export async function sendPushNotification(
  input: PushNotificationPayload,
): Promise<PushSendResult | null> {
  if (!isApiConfigured()) return null;

  try {
    const result = await apiFetch<PushSendResult>('/send-push', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    if (result.sent === 0) {
      console.warn('[push] No notification delivered:', result.reason ?? 'unknown');
    } else {
      console.info(`[push] Sent ${result.sent} notification(s)`);
    }

    return result;
  } catch (error) {
    console.warn('[push] send failed:', error);
    return null;
  }
}
