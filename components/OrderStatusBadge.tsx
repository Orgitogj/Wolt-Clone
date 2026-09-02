import { ORDER_STATUS_TONES, orderStatusLabel } from '@/constants/orderStatus';
import type { OrderStatus } from '@/types/database';
import { StyleSheet, Text, View } from 'react-native';

interface OrderStatusBadgeProps {
  status: OrderStatus;
}

const TONE_STYLES = {
  pending: { backgroundColor: '#FFF3D6', color: '#8A6100' },
  active: { backgroundColor: '#E4F3FB', color: '#0073AB' },
  done: { backgroundColor: '#E5F3EA', color: '#2C7A4B' },
  failed: { backgroundColor: '#FBE9EB', color: '#B32433' },
} as const;

export const OrderStatusBadge = ({ status }: OrderStatusBadgeProps) => {
  const tone = TONE_STYLES[ORDER_STATUS_TONES[status] ?? 'pending'];

  return (
    <View style={[styles.badge, { backgroundColor: tone.backgroundColor }]}>
      <Text style={[styles.text, { color: tone.color }]}>{orderStatusLabel(status)}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
