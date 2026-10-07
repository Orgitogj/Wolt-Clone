import { SupportConversation } from '@/components/support/SupportConversation';
import { SupportRefundList } from '@/components/support/SupportRefundList';
import { Colors } from '@/constants/theme';
import {
  useSupportConversation,
  useSupportRefunds,
  useSupportReportedItems,
} from '@/hooks/useSupport';
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUS_LABELS,
  needsReportedItems,
} from '@/services/supportService';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const Page = () => {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ticketId = id ?? '';

  const conversation = useSupportConversation(ticketId);
  const ticket = conversation.ticket;
  const refunds = useSupportRefunds(ticketId);
  const reportedItems = useSupportReportedItems(
    ticketId,
    !!ticket && needsReportedItems(ticket.category)
  );

  const { canRead, markRead, messages } = conversation;

  useEffect(() => {
    if (canRead) void markRead();
  }, [canRead, markRead, messages.length]);

  if (conversation.isTicketLoading) {
    return (
      <View style={styles.state} testID="support-ticket-loading">
        <Stack.Screen options={{ title: 'Your report' }} />
        <ActivityIndicator size="large" color={Colors.secondary} />
      </View>
    );
  }

  if (!ticket) {
    return (
      <View style={styles.state} testID="support-ticket-unavailable">
        <Stack.Screen options={{ title: 'Your report' }} />
        <Ionicons name="lock-closed-outline" size={40} color={Colors.muted} />
        <Text style={styles.mutedText}>That report is not available on this account.</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.replace('/order/support-tickets')}
          accessibilityRole="button"
          testID="support-ticket-back">
          <Text style={styles.primaryButtonText}>See your reports</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Your report' }} />

      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{SUPPORT_CATEGORY_LABELS[ticket.category]}</Text>
          <Text style={styles.status} testID="support-ticket-status">
            {SUPPORT_STATUS_LABELS[ticket.status]}
          </Text>
        </View>
        <Text style={styles.meta}>
          {ticket.restaurant_name ?? 'Your order'} • {Number(ticket.order_total).toFixed(2)} €
        </Text>

        {!!reportedItems.data?.length && (
          <View style={styles.itemList} testID="support-ticket-items">
            {reportedItems.data.map((item) => (
              <Text key={item.order_item_id} style={styles.meta}>
                {item.reported_quantity} × {item.dish_name ?? 'Item'}
              </Text>
            ))}
          </View>
        )}

        <View style={styles.refundBlock}>
          <Text style={styles.sectionTitle}>Refunds</Text>
          <SupportRefundList refunds={refunds.data ?? []} />
        </View>
      </View>

      <SupportConversation
        messages={conversation.messages}
        outgoing={conversation.outgoing}
        isLoading={conversation.isLoading}
        hasOlder={conversation.hasOlder}
        isLoadingOlder={conversation.isLoadingOlder}
        isOlderError={conversation.isOlderError}
        canSend
        onSend={conversation.send}
        onRetry={conversation.retry}
        onDiscard={conversation.discard}
        onLoadOlder={conversation.loadOlder}
      />
    </KeyboardAvoidingView>
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
  header: {
    gap: 6,
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '800', color: '#000' },
  status: { fontSize: 12, fontWeight: '700', color: Colors.secondary },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#000' },
  meta: { fontSize: 13, color: Colors.muted },
  itemList: { gap: 2 },
  refundBlock: { gap: 6, paddingTop: 8 },
  mutedText: { fontSize: 14, color: Colors.muted, textAlign: 'center' },
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
