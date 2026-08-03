import * as Haptics from 'expo-haptics';
import { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookingSheet } from '@/components/developer/BookingSheet';
import { CreatorBrowseGrid } from '@/components/developer/CreatorBrowseGrid';
import { HomeAmbientBackground } from '@/components/influencer/home/HomeAmbientBackground';
import { colors, spacing } from '@/constants/theme';
import { useAuth, useCurrentDeveloperId } from '@/context/AuthContext';
import { useCampaigns } from '@/context/CampaignsContext';
import { usePitches } from '@/context/PitchesContext';
import { markBrandInvitedCreator } from '@/lib/brandInviteStorage';
import { getDeveloperCampaigns } from '@/lib/developers';
import type { Campaign, CreatorBrowseProfile } from '@/types';

export default function DiscoverTab() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const developerId = useCurrentDeveloperId();
  const { campaigns } = useCampaigns();
  const { submitBookingRequest } = usePitches();

  const [selectedCreator, setSelectedCreator] = useState<CreatorBrowseProfile | null>(null);

  const developerCampaigns = useMemo(
    () => getDeveloperCampaigns(developerId, campaigns),
    [campaigns, developerId],
  );

  const handleInvite = useCallback((creator: CreatorBrowseProfile) => {
    setSelectedCreator(creator);
  }, []);

  const handleSubmit = useCallback(
    (creator: CreatorBrowseProfile, campaign: Campaign) => {
      submitBookingRequest(creator, campaign, developerId);

      const uid = user?.uid;
      if (uid) {
        void markBrandInvitedCreator(uid);
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Invite sent', `${creator.name} was invited to ${campaign.name}.`);
    },
    [developerId, submitBookingRequest, user?.uid],
  );

  return (
    <View style={styles.root}>
      <HomeAmbientBackground />
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Discover</Text>
        <Text style={styles.subtitle}>Invite creators to your campaigns</Text>
      </View>
      <CreatorBrowseGrid bottomInset={insets.bottom} onBook={handleInvite} />
      <BookingSheet
        creator={selectedCreator}
        campaigns={developerCampaigns}
        visible={selectedCreator !== null}
        onClose={() => setSelectedCreator(null)}
        onSubmit={handleSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.sm,
    gap: 2,
  },
  title: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: colors.text,
  },
  subtitle: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 14,
    color: colors.secondary,
  },
});
