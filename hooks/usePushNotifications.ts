import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useAuth } from '@/context/AuthContext';
import { routeForPushNotification } from '@/lib/pushRouting';
import { registerForRemotePushNotifications } from '@/lib/pushNotifications';
import { AppState, type AppStateStatus } from 'react-native';

export function usePushNotifications() {
  const { user } = useAuth();
  const handledResponseIds = useRef(new Set<string>());

  useEffect(() => {
    if (!user?.uid) return;

    let responseSubscription: { remove: () => void } | undefined;
    let appStateSubscription: { remove: () => void } | undefined;
    let mounted = true;

    void (async () => {
      try {
        const Notifications = await import('expo-notifications');
        if (!mounted || !Notifications.addNotificationResponseReceivedListener) return;

        await registerForRemotePushNotifications();

        const syncToken = () => {
          void registerForRemotePushNotifications();
        };

        appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
          if (state === 'active') {
            syncToken();
          }
        });

        responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
          const responseId = response.notification.request.identifier;
          if (handledResponseIds.current.has(responseId)) return;
          handledResponseIds.current.add(responseId);

          const data = response.notification.request.content.data as
            | Record<string, string>
            | undefined;
          const href = routeForPushNotification(data);
          if (href) {
            router.push(href);
          }
        });

        const lastResponse = Notifications.getLastNotificationResponse();
        if (lastResponse) {
          const responseId = lastResponse.notification.request.identifier;
          if (!handledResponseIds.current.has(responseId)) {
            handledResponseIds.current.add(responseId);
            const data = lastResponse.notification.request.content.data as
              | Record<string, string>
              | undefined;
            const href = routeForPushNotification(data);
            if (href) {
              router.push(href);
            }
          }
        }
      } catch (error) {
        console.warn('[push] listener setup failed:', error);
      }
    })();

    return () => {
      mounted = false;
      responseSubscription?.remove();
      appStateSubscription?.remove();
    };
  }, [user?.uid]);
}
