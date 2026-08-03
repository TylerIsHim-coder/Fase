import { Feather } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CreatorBrowseCard } from '@/components/developer/CreatorBrowseCard';
import { filterCreators, mockCreators } from '@/constants/mockCreators';
import { colors, floatingTabBarPadding } from '@/constants/theme';
import type { CreatorBrowseProfile, PriceFilter, TierFilter } from '@/types';

const TIER_FILTERS: { key: TierFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'nano', label: 'Nano' },
  { key: 'micro', label: 'Micro' },
  { key: 'mid', label: 'Mid-tier' },
  { key: 'macro', label: 'Macro' },
];

const PRICE_FILTERS: { key: PriceFilter; label: string }[] = [
  { key: 'all', label: 'All prices' },
  { key: '0-50', label: '$0–50' },
  { key: '50-150', label: '$50–150' },
  { key: '150-300', label: '$150–300' },
  { key: '300-500', label: '$300–500' },
];

interface CreatorBrowseGridProps {
  bottomInset: number;
  onBook: (creator: CreatorBrowseProfile) => void;
}

function FilterPills<T extends string>({
  options,
  active,
  onChange,
}: {
  options: { key: T; label: string }[];
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
      {options.map((option) => {
        const selected = active === option.key;
        return (
          <Pressable
            key={option.key}
            style={[styles.pill, selected && styles.pillActive]}
            onPress={() => onChange(option.key)}>
            <Text style={[styles.pillText, selected && styles.pillTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function CreatorBrowseGrid({ bottomInset, onBook }: CreatorBrowseGridProps) {
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState<TierFilter>('all');
  const [price, setPrice] = useState<PriceFilter>('all');

  const filtered = useMemo(
    () => filterCreators(mockCreators, query, tier, price),
    [price, query, tier],
  );

  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <Feather name="search" size={16} color={colors.secondary} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by niche, name..."
          placeholderTextColor={colors.secondary}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <FilterPills options={TIER_FILTERS} active={tier} onChange={setTier} />
      <FilterPills options={PRICE_FILTERS} active={price} onChange={setPrice} />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.column}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: floatingTabBarPadding(bottomInset, 16) }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<Text style={styles.empty}>No creators match your filters</Text>}
        renderItem={({ item }) => (
          <View style={styles.cell}>
            <CreatorBrowseCard creator={item} onBook={() => onBook(item)} />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 12,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15, color: '#000', paddingVertical: 10 },
  pillRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 12 },
  pill: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#F2F2F2' },
  pillActive: { backgroundColor: '#000' },
  pillText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.secondary },
  pillTextActive: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  column: { gap: 12 },
  cell: { flex: 1, paddingHorizontal: 6 },
  empty: { fontFamily: 'Inter_500Medium', fontSize: 15, color: colors.secondary, textAlign: 'center', paddingTop: 48 },
});
