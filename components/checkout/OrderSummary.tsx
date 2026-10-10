import { Colors } from '@/constants/theme';
import type { CheckoutSummary } from '@/hooks/useCheckout';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export interface OrderSummaryProps {
  summary: CheckoutSummary;
}

export const OrderSummary = ({ summary }: OrderSummaryProps) => (
  <View style={styles.section}>
    <TouchableOpacity style={styles.summaryHeader} onPress={summary.explainFees}>
      <Text style={styles.summaryHeaderText}>How fees work</Text>
      <Ionicons name="chevron-forward" size={16} color={Colors.secondary} />
    </TouchableOpacity>

    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>Item subtotal</Text>
      <Text style={styles.summaryValue}>
        {summary.subtotal.toFixed(2)} {summary.currency}
      </Text>
    </View>

    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>Service fee</Text>
      <Text style={styles.summaryValue}>
        {summary.serviceFee.toFixed(2)} {summary.currency}
      </Text>
    </View>

    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>Delivery fee</Text>
      <Text style={styles.summaryValue}>
        {summary.deliveryFee.toFixed(2)} {summary.currency}
      </Text>
    </View>

    {summary.tipAmount > 0 && (
      <View style={styles.summaryRow}>
        <Text style={styles.summaryLabel}>Courier tip</Text>
        <Text style={styles.summaryValue}>
          {summary.tipAmount.toFixed(2)} {summary.currency}
        </Text>
      </View>
    )}

    {summary.discount > 0 && (
      <View style={styles.summaryRow}>
        <Text style={styles.discountLabel}>Promo {summary.promoCode}</Text>
        <Text style={styles.discountValue}>
          -{summary.discount.toFixed(2)} {summary.currency}
        </Text>
      </View>
    )}

    <View style={[styles.summaryRow, styles.summaryTotal]}>
      <Text style={styles.summaryTotalText}>Total</Text>
      <Text style={styles.summaryTotalValue}>
        {summary.grandTotal.toFixed(2)} {summary.currency}
      </Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  section: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 16,
  },
  summaryHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.secondary,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 15,
    color: '#666',
  },
  summaryValue: {
    fontSize: 15,
    color: '#000',
  },
  discountLabel: {
    fontSize: 14,
    color: '#2C7A4B',
    fontWeight: '600',
  },
  discountValue: {
    fontSize: 14,
    color: '#2C7A4B',
    fontWeight: '700',
  },
  summaryTotal: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e8e8e8',
    marginTop: 4,
  },
  summaryTotalText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  summaryTotalValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
});
