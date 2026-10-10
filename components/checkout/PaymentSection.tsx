import type { CheckoutPayment } from '@/hooks/useCheckout';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export interface PaymentSectionProps {
  payment: CheckoutPayment;
  grandTotal: number;
  currency: string;
}

export const PaymentSection = ({ payment, grandTotal, currency }: PaymentSectionProps) => (
  <>
    <View style={styles.section}>
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <View style={styles.paymentIcon}>
            <Ionicons
              name={payment.method === 'card' ? 'card-outline' : 'cash-outline'}
              size={24}
              color="#000"
            />
          </View>
          <View>
            <Text style={styles.optionText}>
              {payment.method === 'card' ? 'Card' : 'Pay on delivery'}
            </Text>
            <Text style={styles.sectionSubtitle}>
              {payment.cardEnabled
                ? 'Charged when you place the order'
                : 'Card payments are not enabled yet'}
            </Text>
          </View>
        </View>
        <Text style={styles.paymentAmount}>
          {grandTotal.toFixed(2)} {currency}
        </Text>
      </View>
    </View>

    {payment.cardEnabled && (
      <View style={styles.section}>
        <View style={styles.pickerContainer}>
          <TouchableOpacity
            style={[styles.pickerOption, payment.method === 'card' && styles.pickerOptionActive]}
            onPress={() => payment.setMethod('card')}>
            <Text
              style={[
                styles.pickerOptionText,
                payment.method === 'card' && styles.pickerOptionTextActive,
              ]}>
              Card
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pickerOption, payment.method === 'cash' && styles.pickerOptionActive]}
            onPress={() => payment.setMethod('cash')}>
            <Text
              style={[
                styles.pickerOptionText,
                payment.method === 'cash' && styles.pickerOptionTextActive,
              ]}>
              Pay on delivery
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    )}
  </>
);

const styles = StyleSheet.create({
  section: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#999',
  },
  optionText: {
    fontSize: 16,
    color: '#000',
  },
  paymentIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  pickerContainer: {
    flexDirection: 'row',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 4,
  },
  pickerOption: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
  },
  pickerOptionActive: {
    backgroundColor: '#fff',
    boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.08)',
  },
  pickerOptionText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#666',
  },
  pickerOptionTextActive: {
    color: '#000',
    fontWeight: '600',
  },
});
