import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { registerPushToken } from '@/lib/api/push';
import { isApiConfigured } from '@/lib/api/config';
import { ensureAuthReady } from '@/lib/ensureAuthReady';
import { ensureNotificationPermissions } from '@/lib/localNotifications';

const EAS_PROJECT_ID = '363563d0-3b93-4d18-bb63-74818f60a187';

function getProjectId(): string {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return (
    extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    EAS_PROJECT_ID
  );
}

export async function registerForRemotePushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web' || !Constants.isDevice) {
    console.warn('[push] Skipping registration — use a physical device');
    return null;
  }

  const granted = await ensureNotificationPermissions();
  if (!granted) {
    console.warn('[push] Notification permission not granted');
    return null;
  }

  try {
    await ensureAuthReady();
    const Notifications = await import('expo-notifications');

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const projectId = getProjectId();
    const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResult.data;

    if (isApiConfigured()) {
      await registerPushToken(token);
      console.info('[push] Token registered with backend');
    } else {
      console.warn('[push] EXPO_PUBLIC_API_URL not set — token not saved');
    }

    return token;
  } catch (error) {
    console.warn('[push] token registration failed:', error);
    return null;
  }
}

export async function syncPushTokenWithBackend(token: string): Promise<void> {
  if (!isApiConfigured()) return;
  await registerPushToken(token);
}
