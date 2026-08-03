import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';

import { CampaignGridCell } from '@/components/developer/CampaignGridCell';
import type { CampaignVideoUploadPhase } from '@/lib/campaignVideoUpload';
import type { Campaign } from '@/types';

const COLS = 3;
const GAP = 1;

interface CampaignGridProps {
  campaigns: Campaign[];
  uploadProgressById?: Record<string, number>;
  uploadPhaseById?: Record<string, CampaignVideoUploadPhase>;
  onCellPress?: (campaign: Campaign) => void;
  onCellLongPress?: (campaign: Campaign) => void;
  emptyTitle?: string;
  emptySubtitle?: string;
  /** Makes the empty state tappable (e.g. open the create modal) when provided. */
  onEmptyPress?: () => void;
}

export function CampaignGrid({
  campaigns,
  uploadProgressById = {},
  uploadPhaseById = {},
  onCellPress,
  onCellLongPress,
  emptyTitle = 'No campaigns yet',
  emptySubtitle = 'Tap + to post your first clip',
  onEmptyPress,
}: CampaignGridProps) {
  const screenWidth = Dimensions.get('window').width;
  const cellWidth = (screenWidth - GAP * (COLS - 1)) / COLS;
  const cellHeight = cellWidth * (4 / 3);

  if (campaigns.length === 0) {
    const EmptyContainer = onEmptyPress ? Pressable : View;
    return (
      <EmptyContainer
        style={styles.empty}
        {...(onEmptyPress ? { onPress: onEmptyPress, accessibilityRole: 'button' as const } : {})}>
        <Text style={styles.emptyText}>{emptyTitle}</Text>
        <Text style={styles.emptySub}>{emptySubtitle}</Text>
      </EmptyContainer>
    );
  }

  return (
    <View style={styles.grid}>
      {campaigns.map((campaign, index) => {
        const col = index % COLS;
        const isLastInRow = col === COLS - 1;
        return (
          <View
            key={campaign.id}
            style={[
              { marginRight: isLastInRow ? 0 : GAP, marginBottom: GAP },
            ]}>
            <CampaignGridCell
              campaign={campaign}
              width={cellWidth}
              height={cellHeight}
              uploadProgress={uploadProgressById[campaign.id] ?? null}
              uploadPhase={uploadPhaseById[campaign.id]}
              onPress={() => onCellPress?.(campaign)}
              onLongPress={() => onCellLongPress?.(campaign)}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#FFFFFF',
  },
  empty: {
    paddingVertical: 80,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  emptyText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    fontWeight: '700',
    color: '#000',
    marginBottom: 6,
  },
  emptySub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: '#8E8E93',
  },
});
