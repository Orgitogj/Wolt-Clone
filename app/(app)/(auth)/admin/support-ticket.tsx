import { SupportConversation } from '@/components/support/SupportConversation';
import { SupportRefundList } from '@/components/support/SupportRefundList';
import { Colors } from '@/constants/theme';
import useAuthStore from '@/hooks/use-auth-store';
import {
  useApproveSupportRefund,
  useAssignSupportTicket,
  useConfirmCashRefund,
  useOrderRefundSummary,
  useSetSupportStatus,
  useSupportConversation,
  useSupportRefunds,
  useSupportReportedItems,
} from '@/hooks/useSupport';
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUS_LABELS,
  canResolveTicket,
  isRefundWithinBalance,
  needsReportedItems,
  parseRefundAmount,
} from '@/services/supportService';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const Page = () => {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ticketId = id ?? '';
  const adminId = useAuthStore((state) => state.user?.id ?? null);

  const conversation = useSupportConversation(ticketId);
  const ticket = conversation.ticket;
  const refunds = useSupportRefunds(ticketId);
  const summary = useOrderRefundSummary(ticket?.order_id);
  const reportedItems = useSupportReportedItems(
    ticketId,
    !!ticket && needsReportedItems(ticket.category)
  );

  const assign = useAssignSupportTicket(ticketId);
  const setStatus = useSetSupportStatus(ticketId);
  const approve = useApproveSupportRefund(ticketId);
  const confirmCash = useConfirmCashRefund(ticketId);

  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [liability, setLiability] = useState<'platform' | 'restaurant'>('platform');

  const { canRead, markRead, messages } = conversation;

  useEffect(() => {
    if (canRead) void markRead();
  }, [canRead, markRead, messages.length]);

  const remaining = Number(summary.data?.remaining_refundable ?? 0);
  const parsedAmount = parseRefundAmount(amount);
  const refundList = refunds.data ?? [];
  const cashPending = refundList.find(
    (refund) => refund.method === 'cash' && refund.state === 'reserved'
  );

  const canApprove =
    !!ticket &&
    parsedAmount !== null &&
    isRefundWithinBalance(parsedAmount, remaining) &&
    reason.trim().length > 0 &&
    !approve.isPending;

  const warn = (title: string, error: unknown) =>
    Alert.alert(title, error instanceof Error ? error.message : 'Please try again.');

  const onAssign = async (nextAdminId: string | null) => {
    if (!ticket) return;
    try {
      await assign.mutateAsync({ adminId: nextAdminId, revision: ticket.revision });
    } catch (error) {
      warn('We could not change the assignment', error);
    }
  };

  const onStatus = async (status: 'open' | 'in_review' | 'resolved') => {
    if (!ticket) return;
    try {
      await setStatus.mutateAsync({ status, revision: ticket.revision });
    } catch (error) {
      warn('We could not change the status', error);
    }
  };

  const onApprove = async () => {
    if (!canApprove || parsedAmount === null) return;

    Alert.alert(
      'Approve this refund?',
      `${parsedAmount.toFixed(2)} € goes back to the customer.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            try {
              await approve.mutateAsync({
                amount: parsedAmount,
                reason: reason.trim(),
                liability,
                clientRequestId: Crypto.randomUUID(),
              });
              setAmount('');
              setReason('');
            } catch (error) {
              warn('We could not approve the refund', error);
            }
          },
        },
      ]
    );
  };

  const onConfirmCash = async () => {
    if (!cashPending) return;
    const note = reason.trim();
    if (!note) {
      Alert.alert('Add a note', 'Record how the cash was returned before confirming.');
      return;
    }

    try {
      await confirmCash.mutateAsync({ refundId: cashPending.id, reason: note });
      setReason('');
    } catch (error) {
      warn('We could not confirm the cash refund', error);
    }
  };

  if (conversation.isTicketLoading) {
    return (
      <View style={styles.state} testID="admin-ticket-loading">
        <ActivityIndicator size="large" color={Colors.secondary} />
      </View>
    );
  }

  if (!ticket) {
    return (
      <View style={styles.state} testID="admin-ticket-unavailable">
        <Ionicons name="lock-closed-outline" size={40} color={Colors.muted} />
        <Text style={styles.mutedText}>That ticket is not available.</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.replace('/admin/support')}
          accessibilityRole="button"
          testID="admin-ticket-back">
          <Text style={styles.primaryButtonText}>Back to support</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const mine = ticket.assigned_admin_id === adminId;
  const blockedByRefund = !canResolveTicket(refundList);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>{SUPPORT_CATEGORY_LABELS[ticket.category]}</Text>
        <Text style={styles.status} testID="admin-ticket-status">
          {SUPPORT_STATUS_LABELS[ticket.status]}
        </Text>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <Text style={styles.meta}>
          {ticket.restaurant_name ?? 'Restaurant'} • {Number(ticket.order_total).toFixed(2)} € •{' '}
          {ticket.payment_method}
        </Text>
        <Text style={styles.description}>{ticket.description}</Text>

        {!!reportedItems.data?.length && (
          <View style={styles.block} testID="admin-ticket-items">
            <Text style={styles.sectionTitle}>Reported items</Text>
            {reportedItems.data.map((item) => (
              <Text key={item.order_item_id} style={styles.meta}>
                {item.reported_quantity} of {item.ordered_quantity} × {item.dish_name ?? 'Item'} (
                {Number(item.unit_price).toFixed(2)} € each)
              </Text>
            ))}
          </View>
        )}

        <View style={styles.block}>
          <Text style={styles.sectionTitle}>Assignment</Text>
          <Text style={styles.meta} testID="admin-ticket-assignee">
            {ticket.assigned_admin_name ?? 'Unassigned'}
          </Text>
          <View style={styles.row}>
            {!mine && (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => onAssign(adminId)}
                disabled={assign.isPending}
                accessibilityRole="button"
                testID="admin-ticket-take">
                <Text style={styles.secondaryButtonText}>Take this ticket</Text>
              </TouchableOpacity>
            )}
            {!!ticket.assigned_admin_id && (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => onAssign(null)}
                disabled={assign.isPending}
                accessibilityRole="button"
                testID="admin-ticket-release">
                <Text style={styles.secondaryButtonText}>Release</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.sectionTitle}>Status</Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => onStatus('in_review')}
              disabled={setStatus.isPending || ticket.status === 'in_review'}
              accessibilityRole="button"
              testID="admin-ticket-review">
              <Text style={styles.secondaryButtonText}>Mark in review</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, blockedByRefund && styles.secondaryButtonDisabled]}
              onPress={() => onStatus('resolved')}
              disabled={setStatus.isPending || blockedByRefund || ticket.status === 'resolved'}
              accessibilityRole="button"
              accessibilityState={{ disabled: blockedByRefund }}
              testID="admin-ticket-resolve">
              <Text style={styles.secondaryButtonText}>Resolve</Text>
            </TouchableOpacity>
          </View>
          {blockedByRefund && (
            <Text style={styles.meta} testID="admin-ticket-resolve-blocked">
              A refund is still being processed.
            </Text>
          )}
        </View>

        <View style={styles.block}>
          <Text style={styles.sectionTitle}>Refunds</Text>
          <Text style={styles.meta} testID="admin-ticket-remaining">
            {remaining.toFixed(2)} € still refundable of{' '}
            {Number(summary.data?.charged ?? 0).toFixed(2)} €
          </Text>
          <SupportRefundList refunds={refundList} showLiability />

          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder="Refund amount"
            placeholderTextColor={Colors.muted}
            keyboardType="decimal-pad"
            editable={!approve.isPending}
            testID="admin-refund-amount"
          />
          {amount.length > 0 && parsedAmount === null && (
            <Text style={styles.error} testID="admin-refund-amount-error">
              Enter an amount like 4.50
            </Text>
          )}
          {parsedAmount !== null && !isRefundWithinBalance(parsedAmount, remaining) && (
            <Text style={styles.error} testID="admin-refund-balance-error">
              That is more than the {remaining.toFixed(2)} € still refundable.
            </Text>
          )}

          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            placeholder="Why is this refunded?"
            placeholderTextColor={Colors.muted}
            editable={!approve.isPending && !confirmCash.isPending}
            testID="admin-refund-reason"
          />

          <View style={styles.row}>
            {(['platform', 'restaurant'] as const).map((option) => {
              const active = liability === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setLiability(option)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  testID={`admin-refund-liability-${option}`}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {option === 'platform' ? 'We pay' : 'Restaurant pays'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, !canApprove && styles.primaryButtonDisabled]}
            onPress={onApprove}
            disabled={!canApprove}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canApprove }}
            testID="admin-refund-approve">
            {approve.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Approve refund</Text>
            )}
          </TouchableOpacity>

          {!!cashPending && (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={onConfirmCash}
              disabled={confirmCash.isPending}
              accessibilityRole="button"
              testID="admin-refund-confirm-cash">
              <Text style={styles.secondaryButtonText}>
                Confirm {Number(cashPending.amount).toFixed(2)} € returned in cash
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
  },
  title: { flex: 1, fontSize: 18, fontWeight: '800', color: '#000' },
  status: { fontSize: 12, fontWeight: '700', color: Colors.secondary },
  panel: { maxHeight: '58%', backgroundColor: '#fff' },
  panelContent: { padding: 16, gap: 10 },
  block: { gap: 6, paddingTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#000' },
  meta: { fontSize: 13, color: Colors.muted },
  description: { fontSize: 15, color: '#333' },
  error: { fontSize: 13, color: '#B32433' },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: Colors.background,
  },
  mutedText: { fontSize: 14, color: Colors.muted, textAlign: 'center' },
  input: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: Colors.background },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: '#000' },
  chipTextActive: { color: '#fff' },
  primaryButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: Colors.background,
  },
  secondaryButtonDisabled: { opacity: 0.5 },
  secondaryButtonText: { fontSize: 13, fontWeight: '700', color: '#000' },
});

export default Page;
