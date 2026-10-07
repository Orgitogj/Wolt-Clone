import { Colors } from '@/constants/theme';
import { useAdminReconciliations, useRetryReconciliation } from '@/hooks/useReconciliations';
import {
  RECONCILIATION_STATE_LABELS,
  canRetryReconciliation,
} from '@/services/reconciliationService';
import type { AdminReconciliation } from '@/types/database';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const formatMoney = (amount: number, currency: string | null) =>
  `${Number(amount).toFixed(2)} ${currency ?? ''}`.trim();

const formatWhen = (value: string | null) =>
  value ? new Date(value).toLocaleString() : 'Never';

const Page = () => {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const {
    reconciliations,
    isLoading,
    error,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useAdminReconciliations();
  const retry = useRetryReconciliation();

  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  const closeRetry = () => {
    setRetryingId(null);
    setReason('');
  };

  const confirmRetry = (item: AdminReconciliation) => {
    const trimmed = reason.trim();
    if (!trimmed || retry.isPending) return;

    Alert.alert(
      'Retry this refund?',
      `This queues another refund attempt for ${formatMoney(item.amount, item.currency)}. The original refund identity is kept, so a refund that already succeeded will not be repeated.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Retry',
          style: 'destructive',
          onPress: async () => {
            try {
              await retry.mutateAsync({ id: item.id, reason: trimmed });
              closeRetry();
            } catch (retryError) {
              Alert.alert(
                'We could not retry this refund',
                retryError instanceof Error ? retryError.message : 'Please try again.'
              );
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: AdminReconciliation }) => {
    const retryable = canRetryReconciliation(item);
    const isOpen = retryingId === item.id;

    return (
      <View style={styles.card} testID={`reconciliation-${item.id}`}>
        <View style={styles.cardHeader}>
          <Text style={styles.amount}>{formatMoney(item.amount, item.currency)}</Text>
          <View style={[styles.badge, item.state === 'abandoned' && styles.badgeAlert]}>
            <Text style={styles.badgeText}>
              {RECONCILIATION_STATE_LABELS[item.state] ?? item.state}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => router.push(`/order/track?id=${item.order_id}`)}
          accessibilityRole="button"
          testID={`reconciliation-order-${item.id}`}>
          <Text style={styles.link}>Order {item.order_id.slice(0, 8)}</Text>
        </TouchableOpacity>

        {!!item.provider_intent_id && (
          <Text style={styles.meta}>Payment {item.provider_intent_id}</Text>
        )}

        <Text style={styles.meta}>
          {item.attempts} attempt{item.attempts === 1 ? '' : 's'} · last {formatWhen(item.last_attempt_at)}
        </Text>
        <Text style={styles.meta}>Next retry {formatWhen(item.next_attempt_at)}</Text>

        {!!item.provider_status && (
          <Text style={styles.meta}>Provider reports {item.provider_status}</Text>
        )}

        {!!item.last_error && (
          <Text style={styles.failure} testID={`reconciliation-error-${item.id}`}>
            {item.last_error}
          </Text>
        )}

        {item.lease_active && (
          <Text style={styles.meta} testID={`reconciliation-lease-${item.id}`}>
            A worker is handling this right now
          </Text>
        )}

        {isOpen ? (
          <View style={styles.retryBox}>
            <TextInput
              style={styles.reasonInput}
              value={reason}
              onChangeText={setReason}
              placeholder="Why are you retrying this refund?"
              placeholderTextColor={Colors.muted}
              editable={!retry.isPending}
              testID={`reconciliation-reason-${item.id}`}
            />
            <View style={styles.retryActions}>
              <TouchableOpacity onPress={closeRetry} disabled={retry.isPending} accessibilityRole="button">
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.retryButton, (!reason.trim() || retry.isPending) && styles.disabled]}
                onPress={() => confirmRetry(item)}
                disabled={!reason.trim() || retry.isPending}
                accessibilityRole="button"
                testID={`reconciliation-confirm-${item.id}`}>
                {retry.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.retryButtonText}>Retry refund</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          retryable && (
            <TouchableOpacity
              onPress={() => {
                setRetryingId(item.id);
                setReason('');
              }}
              accessibilityRole="button"
              testID={`reconciliation-retry-${item.id}`}>
              <Text style={styles.retryLink}>Retry refund</Text>
            </TouchableOpacity>
          )
        )}
      </View>
    );
  };

  const renderEmpty = () => {
    if (isLoading) {
      return (
        <View style={styles.state} testID="reconciliations-loading">
          <ActivityIndicator size="large" color={Colors.secondary} />
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.state}>
          <Ionicons name="cloud-offline-outline" size={40} color={Colors.muted} />
          <Text style={styles.mutedText}>We could not load the refund queue.</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => refetch()}
            accessibilityRole="button"
            testID="reconciliations-retry">
            <Text style={styles.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.state} testID="reconciliations-empty">
        <Ionicons name="checkmark-circle-outline" size={44} color={Colors.muted} />
        <Text style={styles.mutedText}>No refunds are waiting.</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: top }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>Refunds</Text>
        <View style={styles.backButton} />
      </View>

      <FlatList
        testID="reconciliations-list"
        data={reconciliations}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={reconciliations.length ? styles.listContent : styles.emptyContent}
        refreshing={isRefetching}
        onRefresh={refetch}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footer}>
              <ActivityIndicator color={Colors.secondary} />
            </View>
          ) : isFetchNextPageError ? (
            <TouchableOpacity style={styles.footer} onPress={loadMore} accessibilityRole="button">
              <Text style={styles.retryLink}>Load more</Text>
            </TouchableOpacity>
          ) : null
        }
      />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#000' },
  listContent: { padding: 16, gap: 12 },
  emptyContent: { flexGrow: 1 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  mutedText: { fontSize: 14, color: Colors.muted, textAlign: 'center' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  amount: { fontSize: 17, fontWeight: '800', color: '#000' },
  badge: {
    backgroundColor: '#E4F3FB',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  badgeAlert: { backgroundColor: '#FBE9EB' },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#333' },
  link: { fontSize: 14, fontWeight: '700', color: Colors.secondary },
  meta: { fontSize: 12, color: Colors.muted },
  failure: { fontSize: 12, color: '#B32433' },
  retryLink: { fontSize: 13, fontWeight: '700', color: Colors.secondary, marginTop: 4 },
  retryBox: { gap: 8, marginTop: 4 },
  reasonInput: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  retryActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 16 },
  cancelText: { fontSize: 13, color: Colors.muted },
  retryButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.primary,
  },
  retryButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  disabled: { opacity: 0.5 },
  footer: { paddingVertical: 20, alignItems: 'center' },
});

export default Page;
