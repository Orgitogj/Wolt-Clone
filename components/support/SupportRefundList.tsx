import { Colors } from '@/constants/theme';
import type { SupportRefund, SupportRefundState } from '@/types/database';
import { StyleSheet, Text, View } from 'react-native';

const STATE_LABELS: Record<SupportRefundState, string> = {
  reserved: 'Being processed',
  confirmed: 'Refunded',
  failed: 'Could not be refunded',
  cancelled: 'Cancelled',
};

export interface SupportRefundListProps {
  refunds: SupportRefund[];
  showLiability?: boolean;
}

export const SupportRefundList = ({ refunds, showLiability = false }: SupportRefundListProps) => {
  if (refunds.length === 0) {
    return (
      <Text style={styles.mutedText} testID="support-refunds-empty">
        No refund has been approved yet.
      </Text>
    );
  }

  return (
    <View style={styles.list} testID="support-refunds">
      {refunds.map((refund) => (
        <View key={refund.id} style={styles.row} testID={`support-refund-${refund.id}`}>
          <View style={styles.rowText}>
            <Text style={styles.amount}>
              {Number(refund.amount).toFixed(2)} {refund.currency}
            </Text>
            <Text style={styles.meta}>{refund.reason}</Text>
            {!!refund.failure_reason && (
              <Text style={styles.failure}>{refund.failure_reason}</Text>
            )}
            {showLiability && (
              <Text style={styles.meta}>
                {refund.method === 'cash' ? 'Cash' : 'Card'} •{' '}
                {refund.liability === 'restaurant' ? 'Charged to the restaurant' : 'Paid by us'}
              </Text>
            )}
          </View>
          <Text
            style={[styles.state, refund.state === 'failed' && styles.stateFailed]}
            testID={`support-refund-state-${refund.id}`}>
            {STATE_LABELS[refund.state]}
          </Text>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  list: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowText: { flex: 1, gap: 2 },
  amount: { fontSize: 15, fontWeight: '700', color: '#000' },
  meta: { fontSize: 13, color: Colors.muted },
  failure: { fontSize: 13, color: '#B32433' },
  state: { fontSize: 12, fontWeight: '700', color: Colors.secondary },
  stateFailed: { color: '#B32433' },
  mutedText: { fontSize: 14, color: Colors.muted },
});
