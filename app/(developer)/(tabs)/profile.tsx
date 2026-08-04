import { useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountHeroGradient } from '@/components/profile/AccountHeroGradient';
import { DeveloperAccountHeader } from '@/components/profile/DeveloperAccountHeader';
import { DeveloperProfileInfoPanel } from '@/components/profile/DeveloperProfileInfoPanel';
import { floatingTabBarPadding } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useDeveloperProfile } from '@/context/DeveloperProfileContext';
import { confirmDeleteAccount, deleteAccount } from '@/lib/deleteAccount';
import { pickProfilePhoto } from '@/lib/pickProfilePhoto';
import { resolveProfilePhotoUri } from '@/lib/profilePhoto';

const SHEET_RADIUS = 36;
const SHEET_OVERLAP = 14;
const SHEET_TOP_GAP = 24;

export default function DeveloperProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { profile, setPhotoUrl } = useDeveloperProfile();
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const handleLogout = async () => {
    await signOut();
    router.replace('/onboarding' as Href);
  };

  const handleDeleteAccount = () => {
    if (!user) return;

    confirmDeleteAccount(async () => {
      setIsDeletingAccount(true);
      try {
        await deleteAccount(user);
        router.replace('/onboarding' as Href);
      } finally {
        setIsDeletingAccount(false);
      }
    });
  };

  const handleEditPublicProfile = () => {
    // The brand's "public profile" that creators see is the campaigns grid
    // (`app/(influencer)/developer/[id].tsx` renders the same `CampaignGrid`), not the
    // Dashboard home — so this needs to open Campaigns, not the tabs index.
    router.push('/(developer)/campaigns' as Href);
  };

  const handleLevelInfo = () => {
    router.push('/(developer)/level-system' as Href);
  };

  const handleChangePhoto = useCallback(async () => {
    const uri = await pickProfilePhoto();
    if (!uri) return;

    try {
      const remoteUrl = await resolveProfilePhotoUri(uri);
      setPhotoUrl(remoteUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not upload profile photo.';
      Alert.alert('Photo upload failed', message);
    }
  }, [setPhotoUrl]);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.accountScroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
        alwaysBounceVertical={false}
        overScrollMode="never"
        contentContainerStyle={[
          styles.accountScrollContent,
          { paddingBottom: floatingTabBarPadding(insets.bottom, 16) },
        ]}>
        <View style={styles.heroBlockWrap}>
          <AccountHeroGradient pointerEvents="none" style={styles.heroGradientBackdrop} />
          <View style={styles.heroBlock}>
            <DeveloperAccountHeader
              name={profile.name}
              email={user?.email}
              photoUrl={profile.photoUrl}
              onChangePhoto={() => void handleChangePhoto()}
              onEditPress={handleEditPublicProfile}
            />
            <View style={styles.heroSpacer} />
          </View>
        </View>

        <View style={styles.sheetShell}>
          <DeveloperProfileInfoPanel
            profile={profile}
            onEditPublicProfile={handleEditPublicProfile}
            onLevelInfoPress={handleLevelInfo}
            onLogout={() => void handleLogout()}
            onDeleteAccount={handleDeleteAccount}
            isDeletingAccount={isDeletingAccount}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  accountScroll: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  accountScrollContent: {
    flexGrow: 1,
  },
  heroBlockWrap: {
    position: 'relative',
    width: '100%',
  },
  heroGradientBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: -(SHEET_RADIUS - SHEET_OVERLAP),
  },
  heroBlock: {
    width: '100%',
  },
  heroSpacer: {
    height: SHEET_TOP_GAP,
  },
  sheetShell: {
    flexGrow: 1,
    minHeight: 400,
    marginTop: -SHEET_OVERLAP,
    zIndex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
});
