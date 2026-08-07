import { CategoryList } from '@/components/CategoryList';
import RestaurantHeader from '@/components/RestaurantHeader';
import RestaurantList from '@/components/RestaurantList';
import { Fonts } from '@/constants/theme';
import { useFilterStore } from '@/hooks/use-filters-store';
import { useRestaurants } from '@/hooks/useRestaurants';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const HEADER_HEIGHT = 60;

interface RestaurantListPageProps {
  title: string;
}

const RestaurantListPage = ({ title }: RestaurantListPageProps) => {
  const insets = useSafeAreaInsets();
  const scrollOffset = useSharedValue(0);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const { selectedCuisines, selectedPrice, woltPlusOnly, selectedSort } = useFilterStore();

  const {
    data: restaurants,
    isLoading,
    error,
  } = useRestaurants({
    categoryId: selectedCategoryId ?? undefined,
    cuisines: selectedCuisines.length ? selectedCuisines : undefined,
    sort: selectedSort as any,
  });

  const filteredRestaurants = useMemo(() => {
    return (restaurants ?? []).filter((restaurant) => {
      const matchesPrice =
        !selectedPrice ||
        (selectedPrice === '€' && restaurant.delivery_fee <= 1.5) ||
        (selectedPrice === '€€' && restaurant.delivery_fee > 1.5 && restaurant.delivery_fee <= 2.5) ||
        (selectedPrice === '€€€' && restaurant.delivery_fee > 2.5 && restaurant.delivery_fee <= 3.5) ||
        (selectedPrice === '€€€€' && restaurant.delivery_fee > 3.5);

      const matchesWoltPlus =
        !woltPlusOnly || restaurant.tags.some((tag) => tag.toLowerCase().includes('wolt+'));

      return matchesPrice && matchesWoltPlus;
    });
  }, [restaurants, selectedPrice, woltPlusOnly]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollOffset.value = event.contentOffset.y;
    },
  });

  const hasActiveFilters = selectedCategoryId || selectedCuisines.length > 0 || selectedPrice || woltPlusOnly;

  return (
    <View style={styles.container}>
      <RestaurantHeader title={title} scrollOffset={scrollOffset} />
      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + HEADER_HEIGHT }}>
        <Text style={styles.pageTitle}>{title}</Text>
        <CategoryList selectedCategoryId={selectedCategoryId} onSelectCategory={setSelectedCategoryId} />

        <Text style={styles.allRestaurantsTitle}>All restaurants</Text>
        <RestaurantList
          restaurants={filteredRestaurants}
          isLoading={isLoading}
          error={error}
          emptyMessage={
            hasActiveFilters
              ? 'No restaurants match your filters. Try clearing them.'
              : 'No restaurants available right now.'
          }
        />
      </Animated.ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  pageTitle: {
    fontFamily: Fonts.brandBlack,
    fontSize: 30,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  allRestaurantsTitle: {
    fontFamily: Fonts.brandBold,
    fontSize: 20,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
});
export default RestaurantListPage;
