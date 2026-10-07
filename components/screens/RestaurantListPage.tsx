import { CategoryList } from '@/components/CategoryList';
import { OfferList } from '@/components/promotions/OfferList';
import RestaurantHeader from '@/components/RestaurantHeader';
import RestaurantList from '@/components/RestaurantList';
import { Fonts } from '@/constants/theme';
import { useFilterStore } from '@/hooks/use-filters-store';
import { useRestaurants } from '@/hooks/useRestaurants';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const HEADER_HEIGHT = 60;

interface RestaurantListPageProps {
  title: string;
  subtitle?: string;
  showCategories?: boolean;
  showOffers?: boolean;
}

const RestaurantListPage = ({
  title,
  subtitle,
  showCategories = true,
  showOffers = true,
}: RestaurantListPageProps) => {
  const insets = useSafeAreaInsets();
  const scrollOffset = useSharedValue(0);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const { selectedCuisines, selectedPrice, woltPlusOnly, selectedSort } = useFilterStore();

  const {
    restaurants,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useRestaurants({
    categoryId: selectedCategoryId ?? undefined,
    cuisines: selectedCuisines.length ? selectedCuisines : undefined,
    priceTier: selectedPrice,
    woltPlusOnly,
    sort: selectedSort,
  });

  const hasActiveFilters =
    !!selectedCategoryId || selectedCuisines.length > 0 || !!selectedPrice || woltPlusOnly;

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  const listHeader = (
    <View>
      <Text style={styles.pageTitle}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {showOffers && <OfferList />}
      {showCategories && (
        <CategoryList
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={setSelectedCategoryId}
        />
      )}
      <Text style={styles.allRestaurantsTitle}>All restaurants</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <RestaurantHeader title={title} scrollOffset={scrollOffset} />
      <RestaurantList
        restaurants={restaurants}
        isLoading={isLoading}
        error={error}
        onRetry={refetch}
        onEndReached={onEndReached}
        isFetchingNextPage={isFetchingNextPage}
        isFetchNextPageError={isFetchNextPageError}
        onRetryNextPage={fetchNextPage}
        scrollOffset={scrollOffset}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{ paddingTop: insets.top + HEADER_HEIGHT, paddingBottom: 24 }}
        emptyMessage={
          hasActiveFilters
            ? 'No restaurants match your filters. Try clearing them.'
            : 'No restaurants available right now.'
        }
      />
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
  subtitle: {
    fontSize: 15,
    color: '#666',
    marginTop: -8,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  allRestaurantsTitle: {
    fontFamily: Fonts.brandBold,
    fontSize: 20,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
});
export default RestaurantListPage;
