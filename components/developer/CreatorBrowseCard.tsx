import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { CreatorLevelLock } from '@/components/developer/CreatorLevelLock';
import { formatFollowerCount } from '@/constants/mockCreators';
import { colors } from '@/constants/theme';
import { useDeveloperLevel } from '@/context/DeveloperLevelContext';
import type { CreatorBrowseProfile } from '@/types';

interface CreatorBrowseCardProps {
  creator: CreatorBrowseProfile;
  onBook: () => void;
}

export function CreatorBrowseCard({ creator, onBook }: CreatorBrowseCardProps) {
  const { isCreatorReachableInBrowse, minimumBudgetLabelForTier } = useDeveloperLevel();
  const locked = !isCreatorReachableInBrowse(creator.tier);
  const lockLabel = minimumBudgetLabelForTier(creator.tier);

  return (
    <View style={styles.card}>
      <Image source={{ uri: creator.photoUrl }} style={styles.photo} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{creator.name}</Text>
        <Text style={styles.niche} numberOfLines={1}>{creator.niches[0] ?? 'Creator'}</Text>
        <Text style={styles.followers}>{formatFollowerCount(creator.totalFollowers)} followers</Text>
        <Text style={styles.rate}>${creator.defaultRate}/post</Text>
        <Text style={styles.rating}>★ {creator.averageRating.toFixed(1)}</Text>
        {locked ? (
          <View style={styles.lockedBtn}>
            <Text style={styles.lockedBtnText}>{lockLabel} needed</Text>
          </View>
        ) : (
          <Pressable style={styles.bookBtn} onPress={onBook}>
            <Text style={styles.bookBtnText}>Invite</Text>
          </Pressable>
        )}
      </View>
      {locked && <CreatorLevelLock budgetLabel={lockLabel} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    overflow: 'hidden',
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#9B8EC4',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  photo: { width: '100%', height: 140, backgroundColor: '#F2F2F2' },
  body: { padding: 12, gap: 2 },
  name: { fontFamily: 'Inter_700Bold', fontSize: 14, fontWeight: '700', color: colors.text },
  niche: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.secondary },
  followers: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.secondary, marginTop: 2 },
  rate: { fontFamily: 'Inter_700Bold', fontSize: 16, fontWeight: '700', color: colors.faseGreen, marginTop: 4 },
  rating: { fontFamily: 'Inter_500Medium', fontSize: 12, color: colors.secondary, marginBottom: 8 },
  bookBtn: {
    backgroundColor: colors.faseGreen,
    borderRadius: 20,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  lockedBtn: {
    backgroundColor: '#F2F2F2',
    borderRadius: 20,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, fontWeight: '600', color: colors.secondary },
});
