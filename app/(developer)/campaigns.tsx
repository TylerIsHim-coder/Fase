import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CampaignGrid } from '@/components/developer/CampaignGrid';
import { DeveloperContestSection } from '@/components/contests/DeveloperContestSection';
import { DeveloperCampaignMenuSheet } from '@/components/developer/DeveloperCampaignMenuSheet';
import { EditDisplayNameModal } from '@/components/developer/EditDisplayNameModal';
import { FirstCampaignTutorial } from '@/components/developer/FirstCampaignTutorial';
import { NewCampaignModal } from '@/components/developer/NewCampaignModal';
import { useAuth, useCurrentDeveloperId } from '@/context/AuthContext';
import { useCampaigns } from '@/context/CampaignsContext';
import { useContests } from '@/context/ContestsContext';
import { useCampaignUploads } from '@/context/CampaignUploadContext';
import { useDeveloperProfile } from '@/context/DeveloperProfileContext';
import { useNavAction } from '@/context/NavActionContext';
import { confirmRemoveCampaign } from '@/lib/confirmRemoveCampaign';
import type { CampaignVideoUploadPhase } from '@/lib/campaignVideoUpload';
import {
  loadDeveloperFirstCampaignTutorialState,
  markDeveloperFirstCampaignTutorialComplete,
  hasShownFirstCampaignTutorialThisSession,
  markFirstCampaignTutorialShownThisSession,
} from '@/lib/developerFirstCampaignTutorialStorage';
import { getDeveloperCampaigns } from '@/lib/developers';
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '@/constants/legal';
import { colors, floatingTabBarPadding, spacing, typography } from '@/constants/theme';
import { openWebsite } from '@/lib/openWebsite';
import type { Campaign } from '@/types';

export default function DeveloperCampaignsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { registerCenterAction, consumePendingCenterAction } = useNavAction();
  const { campaigns, removeCampaign } = useCampaigns();
  const { contests } = useContests();
  const { pendingUploads } = useCampaignUploads();
  const { profile, displayName, setAppName, refreshFromCloud } = useDeveloperProfile();
  const { user, signOut } = useAuth();
  const developerId = useCurrentDeveloperId();

  const [modalVisible, setModalVisible] = useState(false);
  const [editNameVisible, setEditNameVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [showFirstCampaignTutorial, setShowFirstCampaignTutorial] = useState(false);
  const [tutorialChecked, setTutorialChecked] = useState(false);
  const [tutorialCompleted, setTutorialCompleted] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function evaluateTutorial() {
      if (!user?.uid) {
        if (!cancelled) {
          setTutorialCompleted(true);
          setTutorialChecked(true);
        }
        return;
      }

      const state = await loadDeveloperFirstCampaignTutorialState(user.uid);
      if (cancelled) return;

      setTutorialCompleted(state.completed);
      setTutorialChecked(true);
    }

    setTutorialChecked(false);
    void evaluateTutorial();

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const developerCampaigns = useMemo(
    () => getDeveloperCampaigns(developerId, campaigns),
    [campaigns, developerId],
  );

  const developerContests = useMemo(
    () =>
      contests.filter(
        (contest) => contest.developerId === developerId && contest.status !== 'draft',
      ),
    [contests, developerId],
  );

  const publishedCampaigns = useMemo(
    () => developerCampaigns.filter((campaign) => campaign.status === 'active'),
    [developerCampaigns],
  );

  const needsFirstCampaignTutorial = useMemo(
    () =>
      publishedCampaigns.length === 0 &&
      pendingUploads.length === 0 &&
      !tutorialCompleted,
    [pendingUploads.length, publishedCampaigns.length, tutorialCompleted],
  );

  const openModal = useCallback(() => {
    setModalVisible(true);
  }, []);

  useEffect(() => {
    registerCenterAction(openModal);
    return () => registerCenterAction(null);
  }, [openModal, registerCenterAction]);

  useEffect(() => {
    if (!tutorialChecked || !needsFirstCampaignTutorial) return;
    if (hasShownFirstCampaignTutorialThisSession()) return;
    markFirstCampaignTutorialShownThisSession();
    setShowFirstCampaignTutorial(true);
  }, [needsFirstCampaignTutorial, tutorialChecked]);

  useFocusEffect(
    useCallback(() => {
      consumePendingCenterAction();
      void refreshFromCloud();
    }, [consumePendingCenterAction, refreshFromCloud]),
  );

  const filteredCampaigns = useMemo(() => {
    const pendingIds = new Set(pendingUploads.map((item) => item.campaign.id));
    const pendingCampaigns = pendingUploads.map((item) => item.campaign);
    const liveCampaigns = publishedCampaigns.filter((campaign) => !pendingIds.has(campaign.id));

    return [...pendingCampaigns, ...liveCampaigns];
  }, [pendingUploads, publishedCampaigns]);

  const uploadProgressById = useMemo(() => {
    const map: Record<string, number> = {};
    pendingUploads.forEach((item) => {
      map[item.campaign.id] = item.progress;
    });
    return map;
  }, [pendingUploads]);

  const uploadPhaseById = useMemo(() => {
    const map: Record<string, CampaignVideoUploadPhase> = {};
    pendingUploads.forEach((item) => {
      map[item.campaign.id] = item.phase;
    });
    return map;
  }, [pendingUploads]);

  const handlePosted = () => {
    if (user?.uid && !tutorialCompleted) {
      setTutorialCompleted(true);
      void markDeveloperFirstCampaignTutorialComplete(user.uid);
    }
  };

  const handleFirstCampaignTutorialComplete = useCallback(() => {
    setShowFirstCampaignTutorial(false);

    if (user?.uid) {
      setTutorialCompleted(true);
      void markDeveloperFirstCampaignTutorialComplete(user.uid);
    }

    setModalVisible(true);
  }, [user?.uid]);

  const openReel = (campaign: Campaign) => {
    router.push({
      pathname: '/(developer)/campaign/[id]',
      params: { id: campaign.id },
    } as Href);
  };

  const openContest = useCallback(
    (contestId: string) => {
      router.push({
        pathname: '/(developer)/contest/[id]',
        params: { id: contestId },
      } as Href);
    },
    [router],
  );

  const handleRemoveCampaign = useCallback(
    (campaign: Campaign) => {
      confirmRemoveCampaign(campaign, async () => {
        try {
          await removeCampaign(campaign.id);
        } catch {
          Alert.alert('Could not remove campaign', 'Please try again.');
        }
      });
    },
    [removeCampaign],
  );

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.navigate('/(developer)/(tabs)/' as Href);
  }, [router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <View style={styles.topBarSide}>
          <Pressable onPress={handleBack} hitSlop={12} style={styles.iconBtn}>
            <Feather name="chevron-left" size={26} color={colors.text} />
          </Pressable>
        </View>
        <Text style={styles.title}>Campaigns</Text>
        <View style={[styles.topBarSide, styles.topBarActions]}>
          {/* This screen has no tab bar, so the center `+` is unreachable here — expose a
              real button instead of relying on the (invisible) floating create action. */}
          <Pressable onPress={openModal} hitSlop={12} style={styles.iconBtn}>
            <Feather name="plus" size={22} color={colors.text} />
          </Pressable>
          <Pressable onPress={() => setMenuVisible(true)} hitSlop={12} style={styles.iconBtn}>
            <Feather name="menu" size={22} color={colors.text} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: floatingTabBarPadding(insets.bottom, 16) }}>
        <CampaignGrid
          campaigns={filteredCampaigns}
          uploadProgressById={uploadProgressById}
          uploadPhaseById={uploadPhaseById}
          onCellPress={openReel}
          onCellLongPress={handleRemoveCampaign}
          emptyTitle="No campaigns yet"
          emptySubtitle="Tap to post your first clip"
          onEmptyPress={openModal}
        />

        <DeveloperContestSection
          contests={developerContests}
          onContestPress={(contest) => openContest(contest.id)}
        />
      </ScrollView>

      {tutorialChecked ? (
        <FirstCampaignTutorial
          visible={showFirstCampaignTutorial}
          userName={displayName}
          onCreateCampaign={handleFirstCampaignTutorialComplete}
        />
      ) : null}

      <NewCampaignModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onPosted={handlePosted}
      />

      <EditDisplayNameModal
        visible={editNameVisible}
        initialName={profile.name}
        title="App name"
        placeholder="FocusFlow"
        onClose={() => setEditNameVisible(false)}
        onSave={setAppName}
      />

      <DeveloperCampaignMenuSheet
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onEditAppName={() => setEditNameVisible(true)}
        onCampaignReach={() => router.push('/(developer)/level-system' as Href)}
        onAccountSettings={() => router.push('/(developer)/(tabs)/profile' as Href)}
        onPrivacyPolicy={() => void openWebsite(PRIVACY_POLICY_URL)}
        onTermsOfService={() => void openWebsite(TERMS_OF_SERVICE_URL)}
        onLogout={() => {
          void signOut().then(() => router.replace('/onboarding' as Href));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  topBarSide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 40,
  },
  topBarActions: {
    justifyContent: 'flex-end',
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.cardTitle,
    fontSize: 18,
    flex: 1,
    textAlign: 'center',
  },
});
