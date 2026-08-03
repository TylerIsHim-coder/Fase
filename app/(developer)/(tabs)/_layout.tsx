import { Tabs } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { DeveloperInAppNotificationBanner } from '@/components/developer/DeveloperInAppNotificationBanner';
import { FaseTabBar } from '@/components/navigation/FaseTabBar';
import { useNotifications } from '@/context/NotificationsContext';

const TAB_BAR_STYLE = {
  position: 'absolute' as const,
  backgroundColor: 'transparent',
  borderTopWidth: 0,
  elevation: 0,
  height: 0,
};

export default function DeveloperTabLayout() {
  const { tabBadges } = useNotifications();

  const tabs = useMemo(
    () => [
      { routeName: 'index', label: 'Dashboard', icon: 'home' as const },
      { routeName: 'discover', label: 'Discover', icon: 'search' as const },
      {
        routeName: 'pitches',
        label: 'Pitches',
        icon: 'inbox' as const,
        badgeCount: tabBadges.developerPitches,
      },
      { routeName: 'analytics', label: 'Analytics', icon: 'bar-chart-2' as const },
    ],
    [tabBadges.developerPitches],
  );

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{ headerShown: false, tabBarStyle: TAB_BAR_STYLE }}
        tabBar={(props) => (
          <FaseTabBar
            {...props}
            tabs={tabs}
            variant="trybe"
            centerIndex={2}
            centerHomeRoute="index"
          />
        )}>
        <Tabs.Screen name="index" options={{ title: 'Dashboard' }} />
        <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
        <Tabs.Screen name="pitches" options={{ title: 'Pitches' }} />
        <Tabs.Screen name="analytics" options={{ title: 'Analytics' }} />
        <Tabs.Screen name="profile" options={{ href: null, title: 'Profile' }} />
      </Tabs>
      <DeveloperInAppNotificationBanner />
    </View>
  );
}
