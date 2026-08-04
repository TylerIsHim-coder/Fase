import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatFollowerCount } from '@/constants/mockCreators';
import { colors } from '@/constants/theme';
import type { Campaign, CreatorBrowseProfile } from '@/types';

interface BookingSheetProps {
  creator: CreatorBrowseProfile | null;
  campaigns: Campaign[];
  visible: boolean;
  onClose: () => void;
  onSubmit: (creator: CreatorBrowseProfile, campaign: Campaign) => void;
}

export function BookingSheet({
  creator,
  campaigns,
  visible,
  onClose,
  onSubmit,
}: BookingSheetProps) {
  const insets = useSafeAreaInsets();
  const activeCampaigns = useMemo(
    () => campaigns.filter((campaign) => campaign.status === 'active'),
    [campaigns],
  );
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  useEffect(() => {
    if (visible && activeCampaigns.length > 0) {
      setSelectedCampaignId(activeCampaigns[0].id);
    }
  }, [activeCampaigns, visible]);

  if (!creator) return null;

  const handleSubmit = () => {
    const selectedCampaign = activeCampaigns.find((campaign) => campaign.id === selectedCampaignId);
    if (!selectedCampaign) {
      Alert.alert('No campaigns', 'Create an active campaign before inviting a creator.');
      return;
    }
    // Haptic + success/failure feedback lives in the caller's onSubmit, which knows
    // whether the booking actually succeeded (avoids firing it twice).
    onSubmit(creator, selectedCampaign);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Image source={{ uri: creator.photoUrl }} style={styles.avatar} />
          <View style={styles.headerText}>
            <Text style={styles.name}>{creator.name}</Text>
            <Text style={styles.meta}>
              {formatFollowerCount(creator.totalFollowers)} followers · ★ {creator.averageRating.toFixed(1)}
            </Text>
            <Text style={styles.rate}>${creator.defaultRate}/post</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={24} color={colors.text} />
          </Pressable>
        </View>
        <Text style={styles.sectionLabel}>Assign to campaign</Text>
        <ScrollView style={styles.campaignList} showsVerticalScrollIndicator={false}>
          {activeCampaigns.length === 0 ? (
            <Text style={styles.emptyCampaigns}>
              Create an active campaign before inviting a creator.
            </Text>
          ) : (
            activeCampaigns.map((campaign) => {
              const selected = campaign.id === selectedCampaignId;
              return (
                <Pressable
                  key={campaign.id}
                  style={[styles.campaignRow, selected && styles.campaignRowSelected]}
                  onPress={() => setSelectedCampaignId(campaign.id)}>
                  <Image source={{ uri: campaign.iconUrl }} style={styles.campaignIcon} />
                  <View style={styles.campaignText}>
                    <Text style={styles.campaignName}>{campaign.name}</Text>
                    <Text style={styles.campaignBudget}>
                      Budget ${campaign.budgetRemaining.toLocaleString()} remaining
                    </Text>
                  </View>
                  {selected && <Feather name="check-circle" size={20} color={colors.faseGreen} />}
                </Pressable>
              );
            })
          )}
        </ScrollView>
        <Text style={styles.chargeNote}>
          You&apos;ll be charged ${creator.defaultRate} when the influencer accepts
        </Text>
        <Pressable
          style={[styles.submitBtn, activeCampaigns.length === 0 && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={activeCampaigns.length === 0}>
          <Text style={styles.submitBtnText}>Send invite</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 8,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5EA',
    marginBottom: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#F2F2F2' },
  headerText: { flex: 1, gap: 2 },
  name: { fontFamily: 'Inter_700Bold', fontSize: 18, fontWeight: '700', color: '#000' },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.secondary },
  rate: { fontFamily: 'Inter_700Bold', fontSize: 16, fontWeight: '700', color: colors.faseGreen, marginTop: 2 },
  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, fontWeight: '600', color: '#000', marginBottom: 10 },
  campaignList: { maxHeight: 180, marginBottom: 16 },
  emptyCampaigns: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.secondary, paddingVertical: 12 },
  campaignRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FAFAFA',
    marginBottom: 8,
  },
  campaignRowSelected: { backgroundColor: '#F0FFF9' },
  campaignIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#EFEFEF' },
  campaignText: { flex: 1, gap: 2 },
  campaignName: { fontFamily: 'Inter_600SemiBold', fontSize: 15, fontWeight: '600', color: '#000' },
  campaignBudget: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.secondary },
  chargeNote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.secondary,
    textAlign: 'center',
    marginBottom: 12,
  },
  submitBtn: {
    backgroundColor: colors.faseGreen,
    borderRadius: 28,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: { opacity: 0.45 },
  submitBtnText: { fontFamily: 'Inter_700Bold', fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
});
