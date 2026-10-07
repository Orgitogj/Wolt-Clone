import { RatingStars } from '@/components/reviews/RatingStars';
import { ReviewCard } from '@/components/reviews/ReviewCard';
import { Colors } from '@/constants/theme';
import { useRestaurantReviews, useReviewSummary } from '@/hooks/useReviews';
import { useRestaurant } from '@/hooks/useRestaurants';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const RATING_ROWS = [5, 4, 3, 2, 1];

const Page = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const restaurantId = id ?? '';

  const { data: restaurant } = useRestaurant(restaurantId);
  const {
    data: summary,
    isLoading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useReviewSummary(restaurantId);

  const {
    reviews,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isRefetching,
  } = useRestaurantReviews(restaurantId);

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  const retryAll = () => {
    void refetch();
    void refetchSummary();
  };

  const breakdown = summary?.rating_breakdown ?? {};
  const total = summary?.review_count ?? 0;

  const header = (
    <View style={styles.summaryCard}>
      {summaryLoading ? (
        <ActivityIndicator color={Colors.secondary} />
      ) : summaryError ? (
        <Text style={styles.mutedText}>Ratings are unavailable right now.</Text>
      ) : (
        <>
          <Text style={styles.average}>{(summary?.average_rating ?? 0).toFixed(1)}</Text>
          <RatingStars rating={summary?.average_rating ?? 0} size={20} />
          <Text style={styles.mutedText}>
            {total === 1 ? '1 review' : `${total} reviews`}
          </Text>

          {total > 0 && (
            <View style={styles.breakdown}>
              {RATING_ROWS.map((value) => {
                const count = Number(breakdown[String(value)] ?? 0);
                const share = total > 0 ? count / total : 0;
                return (
                  <View key={value} style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>{value}</Text>
                    <View style={styles.breakdownTrack}>
                      <View style={[styles.breakdownFill, { flex: Math.max(share, 0.001) }]} />
                      <View style={{ flex: Math.max(1 - share, 0.001) }} />
                    </View>
                    <Text style={styles.breakdownCount}>{count}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}
    </View>
  );

  const renderEmpty = () => {
    if (isLoading) {
      return (
        <View style={styles.state} testID="reviews-loading">
          <ActivityIndicator size="large" color={Colors.secondary} />
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.state}>
          <Ionicons name="cloud-offline-outline" size={40} color={Colors.muted} />
          <Text style={styles.mutedText}>We could not load the reviews.</Text>
          <TouchableOpacity style={styles.retryButton} onPress={retryAll} accessibilityRole="button">
            <Text style={styles.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.state}>
        <Ionicons name="chatbubble-ellipses-outline" size={40} color={Colors.muted} />
        <Text style={styles.mutedText}>No reviews yet. Order and be the first.</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: restaurant?.name ?? 'Reviews' }} />
      <FlatList
        testID="reviews-list"
        data={reviews}
        keyExtractor={(review) => review.id}
        renderItem={({ item }) => <ReviewCard review={item} />}
        ListHeaderComponent={header}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={reviews.length ? styles.listContent : styles.emptyContent}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        refreshing={isRefetching}
        onRefresh={refetch}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footer}>
              <ActivityIndicator color={Colors.secondary} />
            </View>
          ) : isFetchNextPageError ? (
            <View style={styles.footer}>
              <Text style={styles.mutedText}>We could not load more reviews.</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => fetchNextPage()}
                accessibilityRole="button">
                <Text style={styles.retryButtonText}>Load more</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  listContent: { padding: 16, gap: 12 },
  emptyContent: { flexGrow: 1, padding: 16 },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  average: { fontSize: 36, fontWeight: '800', color: '#000' },
  mutedText: { fontSize: 13, color: Colors.muted, textAlign: 'center' },
  breakdown: { alignSelf: 'stretch', marginTop: 10, gap: 6 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breakdownLabel: { width: 12, fontSize: 12, color: Colors.muted },
  breakdownTrack: {
    flex: 1,
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.light,
    overflow: 'hidden',
  },
  breakdownFill: { backgroundColor: '#f5a623' },
  breakdownCount: { width: 24, textAlign: 'right', fontSize: 12, color: Colors.muted },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  footer: { paddingVertical: 20, alignItems: 'center', gap: 8 },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.primary,
  },
  retryButtonText: { color: '#fff', fontWeight: '600' },
});

export default Page;
