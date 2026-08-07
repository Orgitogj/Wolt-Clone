import { Colors, Fonts } from '@/constants/theme';
import { useFilterStore } from '@/hooks/use-filters-store';
import { useCuisines } from '@/hooks/useRestaurants';
import { useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const priceFilters = ['€', '€€', '€€€', '€€€€'];

const sortOptions = ['Recommended', 'Delivery price', 'Rating', 'Delivery time'];

const Page = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: cuisineFilters, isLoading: cuisinesLoading } = useCuisines();
  const {
    selectedCuisines,
    selectedPrice,
    woltPlusOnly,
    selectedSort,
    toggleCuisine,
    setSelectedPrice,
    setWoltPlusOnly,
    setSelectedSort,
    clearFilters,
  } = useFilterStore();

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={[styles.contentContainer, { paddingBottom: 24 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled">
      <View style={styles.container}>
        <Text style={styles.title}>Filter</Text>

        {/* Cuisine Filters */}
        <View style={styles.filterSection}>
          {cuisinesLoading ? (
            <ActivityIndicator color={Colors.secondary} />
          ) : (
            <View style={styles.chipContainer}>
              {(cuisineFilters ?? []).map((cuisine) => (
                <TouchableOpacity
                  key={cuisine}
                  style={[styles.chip, selectedCuisines.includes(cuisine) && styles.chipSelected]}
                  onPress={() => toggleCuisine(cuisine)}
                  activeOpacity={0.8}>
                  <Text
                    style={[
                      styles.chipText,
                      selectedCuisines.includes(cuisine) && styles.chipTextSelected,
                    ]}>
                    {cuisine}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Price Filter */}
        <View style={styles.filterSection}>
          <Text style={styles.sectionTitle}>PRICE</Text>
          <View style={styles.chipContainer}>
            {priceFilters.map((price) => (
              <TouchableOpacity
                key={price}
                style={[styles.chip, selectedPrice === price && styles.chipSelected]}
                onPress={() => setSelectedPrice(price === selectedPrice ? null : price)}
                activeOpacity={0.8}>
                <Text style={[styles.chipText, selectedPrice === price && styles.chipTextSelected]}>
                  {price}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Wolt+ Toggle */}
        <View style={[styles.filterSection, styles.toggleSection]}>
          <Text style={styles.toggleText}>Only show Wolt+ venues</Text>
          <Switch
            value={woltPlusOnly}
            onValueChange={setWoltPlusOnly}
            trackColor={{ false: Colors.light, true: Colors.primary }}
            thumbColor="#fff"
          />
        </View>

        {/* Sort By */}
        <View style={styles.filterSection}>
          <Text style={styles.sectionTitle}>SORT BY</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipContainer}>
            {sortOptions.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.chip, selectedSort === option && styles.chipSelected]}
                onPress={() => setSelectedSort(option)}
                activeOpacity={0.8}>
                <Text style={[styles.chipText, selectedSort === option && styles.chipTextSelected]}>
                  {option}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Reset / Apply Buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.resetButton} activeOpacity={0.8} onPress={clearFilters}>
            <Text style={styles.resetButtonText}>Reset</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.applyButton}
            activeOpacity={0.9}
            onPress={() => router.dismiss()}>
            <Text style={styles.applyButtonText}>Apply</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  container: {
    flex: 1,
  },
  title: {
    fontFamily: Fonts.brandBold,
    fontSize: 32,
    fontWeight: 900,
    marginBottom: 24,
  },
  filterSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
  },
  chipSelected: {
    backgroundColor: Colors.primary,
  },
  chipText: {
    fontSize: 12,
    color: Colors.secondary,
  },
  chipTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  toggleSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#f0f0f0',
  },
  toggleText: {
    fontSize: 16,
    color: '#000',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  resetButton: {
    flex: 1,
    backgroundColor: Colors.primaryLight,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  resetButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.secondary,
  },
  applyButton: {
    flex: 2,
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});

export default Page;