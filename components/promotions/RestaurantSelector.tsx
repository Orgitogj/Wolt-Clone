import { Colors } from '@/constants/theme';
import { useRestaurants } from '@/hooks/useRestaurants';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface RestaurantSelectorProps {
  selectedId: string | null;
  selectedName: string | null;
  onSelect: (restaurant: { id: string; name: string } | null) => void;
}

export const ALL_RESTAURANTS_LABEL = 'All restaurants';

export const RestaurantSelector = ({
  selectedId,
  selectedName,
  onSelect,
}: RestaurantSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const {
    restaurants,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useRestaurants({ search: debounced || undefined });

  const loadMore = () => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  };

  const retryNextPage = () => {
    void fetchNextPage();
  };

  const label = selectedId ? (selectedName ?? 'Selected restaurant') : ALL_RESTAURANTS_LABEL;

  return (
    <View style={styles.container}>
      <Text style={styles.fieldLabel}>Applies to</Text>

      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setIsOpen((open) => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        testID="restaurant-selector-trigger">
        <Ionicons
          name={selectedId ? 'storefront' : 'globe-outline'}
          size={16}
          color={Colors.secondary}
        />
        <Text style={styles.triggerText} numberOfLines={1}>
          {label}
        </Text>
        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.muted} />
      </TouchableOpacity>

      {isOpen && (
        <View style={styles.panel}>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color={Colors.muted} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search restaurants"
              placeholderTextColor={Colors.muted}
              autoCapitalize="none"
              testID="restaurant-selector-search"
            />
          </View>

          <TouchableOpacity
            style={[styles.option, !selectedId && styles.optionSelected]}
            onPress={() => {
              onSelect(null);
              setIsOpen(false);
            }}
            accessibilityRole="button"
            testID="restaurant-option-all">
            <Ionicons name="globe-outline" size={16} color={Colors.secondary} />
            <Text style={styles.optionText}>{ALL_RESTAURANTS_LABEL}</Text>
            {!selectedId && <Ionicons name="checkmark" size={16} color={Colors.secondary} />}
          </TouchableOpacity>

          {isLoading ? (
            <View style={styles.state} testID="restaurant-selector-loading">
              <ActivityIndicator color={Colors.secondary} />
            </View>
          ) : error ? (
            <View style={styles.state}>
              <Text style={styles.mutedText}>We could not load restaurants.</Text>
              <TouchableOpacity
                onPress={() => refetch()}
                accessibilityRole="button"
                testID="restaurant-selector-retry">
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : restaurants.length === 0 ? (
            <View style={styles.state}>
              <Text style={styles.mutedText}>No restaurants match that search.</Text>
            </View>
          ) : (
            <FlatList
              testID="restaurant-selector-list"
              data={restaurants}
              keyExtractor={(item) => item.id}
              style={styles.list}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              onEndReached={loadMore}
              onEndReachedThreshold={0.5}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.option, selectedId === item.id && styles.optionSelected]}
                  onPress={() => {
                    onSelect({ id: item.id, name: item.name });
                    setIsOpen(false);
                  }}
                  accessibilityRole="button"
                  testID={`restaurant-option-${item.id}`}>
                  <Ionicons name="storefront-outline" size={16} color={Colors.secondary} />
                  <Text style={styles.optionText} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {selectedId === item.id && (
                    <Ionicons name="checkmark" size={16} color={Colors.secondary} />
                  )}
                </TouchableOpacity>
              )}
              ListFooterComponent={
                isFetchingNextPage ? (
                  <View style={styles.state}>
                    <ActivityIndicator color={Colors.secondary} />
                  </View>
                ) : isFetchNextPageError ? (
                  <TouchableOpacity
                    style={styles.state}
                    onPress={retryNextPage}
                    accessibilityRole="button">
                    <Text style={styles.retryText}>Load more</Text>
                  </TouchableOpacity>
                ) : null
              }
            />
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  triggerText: { flex: 1, fontSize: 15, color: '#000' },
  panel: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light,
    overflow: 'hidden',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.background,
  },
  searchInput: { flex: 1, fontSize: 14 },
  list: { maxHeight: 180 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.light,
  },
  optionSelected: { backgroundColor: Colors.primaryLight },
  optionText: { flex: 1, fontSize: 14, color: '#000' },
  state: { padding: 12, alignItems: 'center', gap: 6 },
  mutedText: { fontSize: 13, color: Colors.muted },
  retryText: { fontSize: 13, fontWeight: '700', color: Colors.secondary },
});
