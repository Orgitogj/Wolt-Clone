import { Colors } from '@/constants/theme';
import { useMySupportTickets } from '@/hooks/useSupport';
import { SUPPORT_CATEGORY_LABELS, SUPPORT_STATUS_LABELS } from '@/services/supportService';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const Page = () => {
  const router = useRouter();
  const { tickets, isLoading, error, refetch, isRefetching, loadMore, isFetchingNextPage } =
    useMySupportTickets();

  if (isLoading) {
    return (
      <View style={styles.state} testID="support-tickets-loading">
        <Stack.Screen options={{ title: 'Your reports' }} />
        <ActivityIndicator size="large" color={Colors.secondary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.state}>
        <Stack.Screen options={{ title: 'Your reports' }} />
        <Ionicons name="cloud-offline-outline" size={40} color={Colors.muted} />
        <Text style={styles.mutedText}>We could not load your reports.</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => refetch()}
          accessibilityRole="button"
          testID="support-tickets-retry">
          <Text style={styles.primaryButtonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Your reports' }} />
      <FlatList
        data={tickets}
        testID="support-tickets-list"
        keyExtractor={(ticket) => ticket.id}
        contentContainerStyle={styles.listContent}
        refreshing={isRefetching}
        onRefresh={refetch}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        ListEmptyComponent={
          <Text style={styles.mutedText} testID="support-tickets-empty">
            You have not reported a problem yet.
          </Text>
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <ActivityIndicator style={styles.footer} color={Colors.secondary} />
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() =>
              router.push({ pathname: '/order/support-ticket', params: { id: item.id } })
            }
            accessibilityRole="button"
            testID={`support-ticket-row-${item.id}`}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{SUPPORT_CATEGORY_LABELS[item.category]}</Text>
              <Text style={styles.status}>{SUPPORT_STATUS_LABELS[item.status]}</Text>
            </View>
            <Text style={styles.meta}>
              {item.restaurant_name ?? 'Your order'} •{' '}
              {new Date(item.created_at).toLocaleDateString()}
            </Text>
            <Text style={styles.description} numberOfLines={2}>
              {item.description}
            </Text>
            {Number(item.refunded_amount) > 0 && (
              <Text style={styles.refunded} testID={`support-ticket-refunded-${item.id}`}>
                {Number(item.refunded_amount).toFixed(2)} € refunded
              </Text>
            )}
            {Number(item.pending_refund) > 0 && (
              <Text style={styles.meta} testID={`support-ticket-pending-${item.id}`}>
                {Number(item.pending_refund).toFixed(2)} € on its way
              </Text>
            )}
            {item.unread_count > 0 && (
              <Text style={styles.unread} testID={`support-ticket-unread-${item.id}`}>
                {item.unread_count} new {item.unread_count === 1 ? 'message' : 'messages'}
              </Text>
            )}
          </TouchableOpacity>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: Colors.background,
  },
  listContent: { padding: 16, gap: 12 },
  footer: { paddingVertical: 16 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 4 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#000' },
  status: { fontSize: 12, fontWeight: '700', color: Colors.secondary },
  meta: { fontSize: 13, color: Colors.muted },
  description: { fontSize: 14, color: '#333' },
  refunded: { fontSize: 13, fontWeight: '700', color: Colors.secondary },
  unread: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  mutedText: { fontSize: 14, color: Colors.muted, textAlign: 'center', paddingVertical: 24 },
  primaryButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

export default Page;
