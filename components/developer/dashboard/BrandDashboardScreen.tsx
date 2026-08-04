import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeAmbientBackground } from '@/components/influencer/home/HomeAmbientBackground';
import { colors, floatingTabBarPadding, spacing } from '@/constants/theme';
import { useAuth, useCurrentDeveloperId } from '@/context/AuthContext';
import { useCampaigns } from '@/context/CampaignsContext';
import { useDeveloperFollowers } from '@/context/DeveloperFollowersContext';
import { useDeveloperProfile } from '@/context/DeveloperProfileContext';
import { useNotifications } from '@/context/NotificationsContext';
import { usePitches } from '@/context/PitchesContext';
import { isDeveloperActivityNotification } from '@/lib/campaignActivityNotifications';
import {
  brandPulseCounts,
  brandStatusPillText,
  buildBrandGettingStarted,
  campaignsHaveShopLink,
  developerSpendInLastDays,
  topCreatorsFromPaidDeals,
  type BrandGettingStartedId,
} from '@/lib/brandDashboard';
import { loadBrandHasInvitedCreator } from '@/lib/brandInviteStorage';
import { formatCurrencyAmount } from '@/lib/dealPayment';
import { followerLookupDeveloperIds, getDeveloperCampaigns } from '@/lib/developers';
import { getDeveloperPaidDeals, getDeveloperPitches } from '@/lib/getDeveloperPitches';
import { isUserUploadedPhotoUrl } from '@/lib/profilePhoto';

const SPEND_WINDOW_DAYS = 30;

interface BrandDashboardScreenProps {
  onCreateCampaign: () => void;
}

export function BrandDashboardScreen({ onCreateCampaign }: BrandDashboardScreenProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const developerId = useCurrentDeveloperId();
  const { displayName, profile } = useDeveloperProfile();
  const { campaigns } = useCampaigns();
  const { deals } = usePitches();
  const { getFollowerCountForLookup } = useDeveloperFollowers();
  const { notifications } = useNotifications();

  const [hasInvitedFlag, setHasInvitedFlag] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const uid = user?.uid;
      if (uid) {
        void loadBrandHasInvitedCreator(uid).then((value) => {
          if (!cancelled) setHasInvitedFlag(value);
        });
      }
      return () => {
        cancelled = true;
      };
    }, [user?.uid]),
  );

  const developerCampaigns = useMemo(
    () => getDeveloperCampaigns(developerId, campaigns),
    [campaigns, developerId],
  );

  const publishedCampaigns = useMemo(
    () => developerCampaigns.filter((campaign) => campaign.status === 'active'),
    [developerCampaigns],
  );

  const pitches = useMemo(
    () => getDeveloperPitches(developerId, campaigns, deals),
    [campaigns, deals, developerId],
  );

  const paidScopeDeals = useMemo(
    () => getDeveloperPaidDeals(developerId, campaigns, deals),
    [campaigns, deals, developerId],
  );

  const newPitchCount = useMemo(
    () => pitches.filter((pitch) => pitch.status === 'new').length,
    [pitches],
  );

  const openPitchCount = useMemo(
    () =>
      pitches.filter((pitch) => pitch.status === 'new' || pitch.status === 'negotiating').length,
    [pitches],
  );

  const followerLookupIds = useMemo(
    () => followerLookupDeveloperIds(developerId, campaigns),
    [campaigns, developerId],
  );

  const followerCount = getFollowerCountForLookup(followerLookupIds);

  const activityUnreadCount = useMemo(
    () =>
      notifications.filter((item) => isDeveloperActivityNotification(item.type) && !item.read)
        .length,
    [notifications],
  );

  const pulse = useMemo(
    () =>
      brandPulseCounts({
        activeCampaigns: publishedCampaigns.length,
        openPitches: openPitchCount,
        followers: followerCount,
      }),
    [publishedCampaigns.length, openPitchCount, followerCount],
  );

  const gettingStarted = useMemo(
    () =>
      buildBrandGettingStarted({
        hasPhoto: isUserUploadedPhotoUrl(profile.photoUrl),
        hasDisplayName: Boolean(displayName?.trim()),
        campaignCount: publishedCampaigns.length,
        hasCampaignShopLink: campaignsHaveShopLink(developerCampaigns),
        hasInvitedCreator: hasInvitedFlag,
      }),
    [
      profile.photoUrl,
      displayName,
      publishedCampaigns.length,
      developerCampaigns,
      hasInvitedFlag,
    ],
  );

  const completedCount = gettingStarted.filter((item) => item.done).length;

  const spend30d = useMemo(
    () => developerSpendInLastDays(paidScopeDeals, SPEND_WINDOW_DAYS),
    [paidScopeDeals],
  );

  const topCreators = useMemo(
    () => topCreatorsFromPaidDeals(paidScopeDeals, 3),
    [paidScopeDeals],
  );

  const goProfile = useCallback(
    () => router.push('/(developer)/(tabs)/profile' as Href),
    [router],
  );
  const goCampaigns = useCallback(
    () => router.push('/(developer)/campaigns' as Href),
    [router],
  );
  const goPitches = useCallback(
    () => router.navigate('/(developer)/(tabs)/pitches' as Href),
    [router],
  );
  const goDiscover = useCallback(
    () => router.navigate('/(developer)/(tabs)/discover' as Href),
    [router],
  );
  const goFollowers = useCallback(
    () => router.push('/(developer)/followers' as Href),
    [router],
  );
  const goActivity = useCallback(
    () => router.push('/(developer)/activity' as Href),
    [router],
  );

  const handleGettingStartedPress = useCallback(
    (id: BrandGettingStartedId) => {
      switch (id) {
        case 'profile':
          goProfile();
          break;
        case 'campaign':
        case 'shop-link':
          goCampaigns();
          break;
        case 'invite':
          goDiscover();
          break;
      }
    },
    [goProfile, goCampaigns, goDiscover],
  );

  const photoUri = isUserUploadedPhotoUrl(profile.photoUrl) ? profile.photoUrl : undefined;
  const initials =
    (displayName || 'Brand')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'BR';

  const statusPillText = brandStatusPillText(newPitchCount);
  const isCaughtUp = newPitchCount <= 0;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <HomeAmbientBackground />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + spacing.md,
          paddingBottom: floatingTabBarPadding(insets.bottom, 28),
        }}>
        <View style={styles.header}>
          <View style={styles.welcomeCopy}>
            <Text style={styles.welcomeEyebrow}>Welcome 👋</Text>
            <Text style={styles.welcomeName} numberOfLines={1}>
              {displayName || 'Brand'}
            </Text>
          </View>

          <Pressable
            style={styles.iconButton}
            onPress={goActivity}
            accessibilityRole="button"
            accessibilityLabel="Open activity">
            <Feather name="bell" size={20} color={colors.text} />
            {activityUnreadCount > 0 ? <View style={styles.iconButtonBadge} /> : null}
          </Pressable>

          <Pressable
            style={styles.avatar}
            onPress={goProfile}
            accessibilityRole="button"
            accessibilityLabel="Open profile">
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarInitials}>{initials}</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusPill,
              isCaughtUp ? styles.statusPillCalm : styles.statusPillActive,
            ]}>
            <Feather
              name={isCaughtUp ? 'check-circle' : 'bell'}
              size={14}
              color={isCaughtUp ? colors.faseGreen : colors.accent}
            />
            <Text
              style={[
                styles.statusPillText,
                isCaughtUp ? styles.statusPillTextCalm : styles.statusPillTextActive,
              ]}>
              {statusPillText}
            </Text>
          </View>
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroInner}>
            <LinearGradient
              colors={['#F8EAF4', '#F0EEFF', '#E4F3FB']}
              locations={[0, 0.45, 1]}
              start={{ x: 0, y: 0.3 }}
              end={{ x: 1, y: 0.7 }}
              style={StyleSheet.absoluteFill}
            />
            <LinearGradient
              colors={['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.15)', 'rgba(255,255,255,0)']}
              locations={[0, 0.35, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <Text style={styles.heroLabel}>📊 Brand pulse</Text>
            <View style={styles.heroMetricsRow}>
              <Pressable style={styles.heroMetric} onPress={goCampaigns} accessibilityRole="button">
                <Text style={styles.heroMetricValue}>{pulse.activeCampaigns}</Text>
                <Text style={styles.heroMetricLabel}>Active{'\n'}campaigns</Text>
              </Pressable>
              <View style={styles.heroDivider} />
              <Pressable style={styles.heroMetric} onPress={goPitches} accessibilityRole="button">
                <Text style={styles.heroMetricValue}>{pulse.openPitches}</Text>
                <Text style={styles.heroMetricLabel}>Open{'\n'}pitches</Text>
              </Pressable>
              <View style={styles.heroDivider} />
              <Pressable style={styles.heroMetric} onPress={goFollowers} accessibilityRole="button">
                <Text style={styles.heroMetricValue}>{pulse.followers}</Text>
                <Text style={styles.heroMetricLabel}>Followers</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.gettingStartedCard}>
          <View style={styles.gettingStartedHeader}>
            <Text style={styles.gettingStartedTitle}>Getting started</Text>
            <Text style={styles.gettingStartedCount}>{completedCount}/4</Text>
          </View>
          {gettingStarted.map((item) => (
            <Pressable
              key={item.id}
              style={styles.gettingStartedRow}
              onPress={() => handleGettingStartedPress(item.id)}
              accessibilityRole="button">
              <Feather
                name={item.done ? 'check-circle' : 'circle'}
                size={20}
                color={item.done ? colors.faseGreen : colors.secondary}
              />
              <Text
                style={[
                  styles.gettingStartedText,
                  item.done && styles.gettingStartedTextDone,
                ]}>
                {item.title}
              </Text>
              {!item.done ? (
                <Feather name="chevron-right" size={18} color={colors.secondary} />
              ) : null}
            </Pressable>
          ))}
        </View>

        <View style={styles.row2up}>
          <Pressable style={styles.actionCard} onPress={goPitches} accessibilityRole="button">
            <Text style={styles.actionCardValue}>{newPitchCount}</Text>
            <Text style={styles.actionCardLabel}>Pitches waiting</Text>
          </Pressable>
          <Pressable
            style={styles.actionCard}
            onPress={goCampaigns}
            accessibilityRole="button">
            <Text style={styles.actionCardValue}>{publishedCampaigns.length}</Text>
            <Text style={styles.actionCardLabel}>Your campaigns</Text>
          </Pressable>
        </View>

        <View style={styles.row2up}>
          <Pressable
            style={styles.secondaryCard}
            disabled={spend30d > 0}
            onPress={goDiscover}
            accessibilityRole="button">
            <Text style={styles.secondaryCardTitle}>Creator spend</Text>
            <Text style={styles.secondaryCardSubtitle}>Last 30 days</Text>
            {spend30d > 0 ? (
              <Text style={styles.secondaryCardValue}>{formatCurrencyAmount(spend30d)}</Text>
            ) : (
              <Text style={styles.secondaryCardEmptyCta}>Discover creators →</Text>
            )}
          </Pressable>

          <Pressable
            style={styles.secondaryCard}
            disabled={topCreators.length > 0}
            onPress={onCreateCampaign}
            accessibilityRole="button">
            <Text style={styles.secondaryCardTitle}>Top creators</Text>
            {topCreators.length > 0 ? (
              <View style={styles.topCreatorsList}>
                {topCreators.map((creator) => (
                  <View key={creator.influencerId} style={styles.topCreatorRow}>
                    <Text style={styles.topCreatorName} numberOfLines={1}>
                      {creator.name}
                    </Text>
                    <Text style={styles.topCreatorAmount}>
                      {formatCurrencyAmount(creator.totalSpent)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.secondaryCardEmptyCta}>Create a campaign →</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const CARD_BORDER = 'rgba(0,0,0,0.04)';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  welcomeCopy: {
    flex: 1,
    gap: 2,
  },
  welcomeEyebrow: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 14,
    color: colors.secondary,
  },
  welcomeName: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  iconButtonBadge: {
    position: 'absolute',
    top: 9,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(254, 44, 85, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitials: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.accent,
  },
  statusRow: {
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: 999,
  },
  statusPillCalm: {
    backgroundColor: 'rgba(0, 194, 138, 0.1)',
  },
  statusPillActive: {
    backgroundColor: 'rgba(254, 44, 85, 0.08)',
  },
  statusPillText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 13,
    fontWeight: '600',
  },
  statusPillTextCalm: {
    color: colors.faseGreen,
  },
  statusPillTextActive: {
    color: colors.accent,
  },
  heroCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#9B8EC4',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 20,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  heroInner: {
    borderRadius: 24,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    overflow: 'hidden',
    backgroundColor: '#F4F0FA',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    gap: spacing.lg,
  },
  heroLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  heroMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroMetric: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  heroMetricValue: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
  },
  heroMetricLabel: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 12,
    color: colors.secondary,
    textAlign: 'center',
    lineHeight: 15,
  },
  heroDivider: {
    width: StyleSheet.hairlineWidth,
    height: 36,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  gettingStartedCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  gettingStartedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  gettingStartedTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  gettingStartedCount: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 14,
    fontWeight: '600',
    color: colors.secondary,
  },
  gettingStartedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: CARD_BORDER,
  },
  gettingStartedText: {
    flex: 1,
    fontFamily: 'Manrope_500Medium',
    fontSize: 15,
    color: colors.text,
  },
  gettingStartedTextDone: {
    color: colors.secondary,
    textDecorationLine: 'line-through',
  },
  row2up: {
    flexDirection: 'row',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  actionCard: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: 4,
  },
  actionCardValue: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
  },
  actionCardLabel: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    color: colors.secondary,
  },
  secondaryCard: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: 4,
    minHeight: 104,
  },
  secondaryCardTitle: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  secondaryCardSubtitle: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 12,
    color: colors.secondary,
  },
  secondaryCardValue: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.xs,
    letterSpacing: -0.4,
  },
  secondaryCardEmptyCta: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
    marginTop: spacing.xs,
  },
  topCreatorsList: {
    marginTop: spacing.xs,
    gap: 6,
  },
  topCreatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  topCreatorName: {
    flex: 1,
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    color: colors.text,
  },
  topCreatorAmount: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 13,
    fontWeight: '600',
    color: colors.faseGreen,
  },
});
