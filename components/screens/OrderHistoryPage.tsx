import { OrderStatusBadge } from '@/components/OrderStatusBadge';
import { RatingStars } from '@/components/reviews/RatingStars';
import { isTerminalStatus } from '@/constants/orderStatus';
import { Colors } from '@/constants/theme';
import { useOrderHistory } from '@/hooks/useOrderHistory';
import { useMyReviews } from '@/hooks/useReviews';
import type { OrderWithItems } from '@/types/database';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface OrderHistoryPageProps {
  title?: string;
  showBackButton?: boolean;
}

type Row = { kind: 'section'; title: string } | { kind: 'order'; order: OrderWithItems };

const OrderHistoryPage = ({
  title = 'Your orders',
  showBackButton = false,
}: OrderHistoryPageProps) => {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const { data: orders, isLoading, error, refetch, isRefetching } = useOrderHistory();
  const { data: myReviews } = useMyReviews();

  const rows = useMemo<Row[]>(() => {
    const all = orders ?? [];
    const active = all.filter((order) => !isTerminalStatus(order.status));
    const past = all.filter((order) => isTerminalStatus(order.status));

    const result: Row[] = [];
    if (active.length) {
      result.push({ kind: 'section', title: 'In progress' });
      active.forEach((order) => result.push({ kind: 'order', order }));
    }
    if (past.length) {
      result.push({ kind: 'section', title: 'Past orders' });
      past.forEach((order) => result.push({ kind: 'order', order }));
    }
    return result;
  }, [orders]);

  const reviewFor = (orderId: string) =>
    (myReviews ?? []).find((review) => review.order_id === orderId);

  const renderBody = () => {
    if (isLoading) {
      return (
        <View style={styles.emptyState} testID="orders-loading">
          <ActivityIndicator size="large" color={Colors.secondary} />
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="cloud-offline-outline" size={48} color={Colors.muted} />
          <Text style={styles.emptyTitle}>We could not load your orders</Text>
          <Text style={styles.emptyText}>Check your connection and try again.</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => refetch()}
            accessibilityRole="button">
            <Text style={styles.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (rows.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="receipt-outline" size={56} color={Colors.muted} />
          <Text style={styles.emptyTitle}>No orders yet</Text>
          <Text style={styles.emptyText}>
            Your orders will appear here after you place your first one.
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => router.push('/restaurants')}
            accessibilityRole="button">
            <Text style={styles.retryButtonText}>Browse restaurants</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <FlatList
        data={rows}
        testID="orders-list"
        keyExtractor={(row, index) =>
          row.kind === 'section' ? `section-${row.title}` : `order-${row.order.id}-${index}`
        }
        contentContainerStyle={styles.listContent}
        refreshing={isRefetching}
        onRefresh={refetch}
        renderItem={({ item }) => {
          if (item.kind === 'section') {
            return <Text style={styles.sectionTitle}>{item.title}</Text>;
          }

          const order = item.order;
          return (
            <TouchableOpacity
              style={styles.card}
              testID={`order-row-${order.id}`}
              onPress={() => router.push(`/order/track?id=${order.id}`)}>
              <View style={styles.cardHeader}>
                <Text style={styles.restaurantName}>{order.restaurant?.name ?? 'Restaurant'}</Text>
                <Text style={styles.amount}>{order.total.toFixed(2)} €</Text>
              </View>
              <Text style={styles.meta}>
                {order.delivery_mode === 'pickup' ? 'Pickup' : 'Delivery'} •{' '}
                {new Date(order.created_at).toLocaleDateString()}
              </Text>
              <View style={styles.statusRow}>
                <OrderStatusBadge status={order.status} />
              </View>

              <View style={styles.reorderRow}>
                <TouchableOpacity
                  onPress={() => router.push(`/order/reorder?id=${order.id}`)}
                  accessibilityRole="button"
                  testID={`reorder-${order.id}`}>
                  <Text style={styles.reorderAction}>Order again</Text>
                </TouchableOpacity>
                {order.status === 'delivered' && (
                  <TouchableOpacity
                    onPress={() => router.push(`/order/support?id=${order.id}`)}
                    accessibilityRole="button"
                    testID={`report-problem-${order.id}`}>
                    <Text style={styles.reorderAction}>Report a problem</Text>
                  </TouchableOpacity>
                )}
              </View>

              {order.status === 'delivered' && (
                <View style={styles.reviewRow}>
                  {reviewFor(order.id) ? (
                    <>
                      <RatingStars rating={reviewFor(order.id)!.rating} size={13} />
                      <TouchableOpacity
                        onPress={() => router.push(`/order/review?id=${order.id}`)}
                        accessibilityRole="button"
                        testID={`edit-review-${order.id}`}>
                        <Text style={styles.reviewAction}>Edit review</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      onPress={() => router.push(`/order/review?id=${order.id}`)}
                      accessibilityRole="button"
                      testID={`rate-order-${order.id}`}>
                      <Text style={styles.reviewAction}>Rate your order</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: top }]}>
        {showBackButton ? (
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={24} color="#000" />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
        <Text style={styles.title}>{title}</Text>
        <View style={styles.headerSpacer} />
      </View>
      {renderBody()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
  },
  headerSpacer: {
    width: 40,
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  card: {
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    padding: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  restaurantName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
  },
  amount: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.secondary,
  },
  meta: {
    fontSize: 13,
    color: Colors.muted,
  },
  statusRow: {
    marginTop: 8,
  },
  reorderRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e3e3e3',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  reorderAction: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.secondary,
  },
  reviewRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e3e3e3',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  reviewAction: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.secondary,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
    marginTop: 12,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.primary,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});

export default OrderHistoryPage;
