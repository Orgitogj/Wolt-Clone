import { AdminEmpty, AdminScreen, adminStyles } from '@/components/admin/AdminScreen';
import { OrderStatusBadge } from '@/components/OrderStatusBadge';
import {
  ADMIN_ORDER_ACTIONS,
  ADMIN_ORDER_FILTERS,
  type AdminOrderAction,
} from '@/constants/orderStatus';
import { Colors } from '@/constants/theme';
import { useAdminOrders, useAdminRefund, useAdminTransitionOrder, useIsAdmin } from '@/hooks/useAdmin';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import type { AdminOrderRow } from '@/types/database';
import { formatMoney } from '@/utils/currency';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface PendingAction {
  orderId: string;
  action: AdminOrderAction;
}

const Page = () => {
  const { isAdmin } = useIsAdmin();
  const { data: settings } = usePlatformSettings();

  const [filterKey, setFilterKey] = useState(ADMIN_ORDER_FILTERS[0].key);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState('');
  const [refunding, setRefunding] = useState<AdminOrderRow | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');

  const filter = ADMIN_ORDER_FILTERS.find((item) => item.key === filterKey) ?? ADMIN_ORDER_FILTERS[0];
  const { data: orders, isLoading, refetch, isRefetching } = useAdminOrders(
    filter.statuses,
    search,
    isAdmin
  );
  const transition = useAdminTransitionOrder();
  const refund = useAdminRefund();

  const currency = settings?.currency;

  const runAction = async (orderId: string, action: AdminOrderAction, note?: string | null) => {
    try {
      await transition.mutateAsync({ orderId, to: action.to, reason: note ?? null });
      setPending(null);
      setReason('');
    } catch (error) {
      Alert.alert(
        'Could not update order',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  };

  const onActionPress = (orderId: string, action: AdminOrderAction) => {
    if (action.requiresReason) {
      setPending({ orderId, action });
      setReason('');
      return;
    }
    runAction(orderId, action);
  };

  const openRefund = (order: AdminOrderRow) => {
    const remaining = Number(order.total) - Number(order.amount_refunded);
    setRefunding(order);
    setRefundAmount(remaining.toFixed(2));
    setRefundReason('');
  };

  const submitRefund = async () => {
    if (!refunding) return;
    const amount = Number(refundAmount.replace(',', '.'));
    const remaining = Number(refunding.total) - Number(refunding.amount_refunded);

    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) {
      Alert.alert('Check the amount', `Enter an amount between 0 and ${remaining.toFixed(2)}.`);
      return;
    }

    try {
      await refund.mutateAsync({
        orderId: refunding.order_id,
        amount,
        reason: refundReason.trim() || undefined,
      });
      setRefunding(null);
    } catch (error) {
      Alert.alert(
        'Refund failed',
        error instanceof Error ? error.message : 'The payment service is unavailable.'
      );
    }
  };

  const renderOrder = ({ item }: { item: AdminOrderRow }) => {
    const actions = ADMIN_ORDER_ACTIONS[item.status] ?? [];
    const isPending = pending?.orderId === item.order_id;
    const isRefunding = refunding?.order_id === item.order_id;
    const refundable =
      item.payment_status === 'succeeded' &&
      Number(item.amount_refunded) < Number(item.total);

    return (
      <View style={adminStyles.card}>
        <View style={adminStyles.cardHeader}>
          <View>
            <Text style={adminStyles.cardTitle}>#{item.order_id.slice(0, 8)}</Text>
            <Text style={adminStyles.cardMeta}>
              {new Date(item.created_at).toLocaleString()}
            </Text>
          </View>
          <OrderStatusBadge status={item.status} />
        </View>

        <View style={styles.row}>
          <Ionicons name="storefront-outline" size={15} color={Colors.muted} />
          <Text style={adminStyles.cardMeta}>{item.restaurant_name}</Text>
        </View>

        <View style={styles.row}>
          <Ionicons name="person-outline" size={15} color={Colors.muted} />
          <Text style={adminStyles.cardMeta}>
            {item.customer_name || item.customer_email || 'Customer'}
          </Text>
        </View>

        <View style={styles.row}>
          <Ionicons
            name={item.delivery_mode === 'pickup' ? 'bag-handle-outline' : 'bicycle-outline'}
            size={15}
            color={Colors.muted}
          />
          <Text style={adminStyles.cardMeta}>
            {item.delivery_mode === 'pickup' ? 'Pickup' : 'Delivery'}
            {item.courier_name ? ` • ${item.courier_name}` : ''}
            {item.delivery_status ? ` • ${item.delivery_status.replace(/_/g, ' ')}` : ''}
          </Text>
        </View>

        <View style={styles.row}>
          <Ionicons name="card-outline" size={15} color={Colors.muted} />
          <Text style={adminStyles.cardMeta}>
            {item.payment_method} • {item.payment_status}
            {Number(item.amount_refunded) > 0
              ? ` • ${formatMoney(item.amount_refunded, currency)} refunded`
              : ''}
          </Text>
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{formatMoney(item.total, currency)}</Text>
        </View>

        {isPending ? (
          <View style={styles.panel}>
            <Text style={adminStyles.label}>Reason recorded on the order history</Text>
            <TextInput
              style={adminStyles.input}
              placeholder="Why are you making this change?"
              placeholderTextColor={Colors.muted}
              value={reason}
              onChangeText={setReason}
              autoFocus
            />
            <View style={adminStyles.actions}>
              <TouchableOpacity
                style={[adminStyles.action, adminStyles.actionGhost]}
                onPress={() => setPending(null)}>
                <Text style={adminStyles.actionGhostText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[adminStyles.action, adminStyles.actionDestructive]}
                disabled={transition.isPending}
                onPress={() => runAction(item.order_id, pending.action, reason.trim() || null)}>
                <Text style={adminStyles.actionDestructiveText}>
                  Confirm {pending.action.label.toLowerCase()}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : isRefunding ? (
          <View style={styles.panel}>
            <Text style={adminStyles.label}>
              Refund up to {formatMoney(Number(item.total) - Number(item.amount_refunded), currency)}
            </Text>
            <TextInput
              style={adminStyles.input}
              placeholder="Amount"
              placeholderTextColor={Colors.muted}
              keyboardType="decimal-pad"
              value={refundAmount}
              onChangeText={setRefundAmount}
            />
            <TextInput
              style={adminStyles.input}
              placeholder="Reason for the customer"
              placeholderTextColor={Colors.muted}
              value={refundReason}
              onChangeText={setRefundReason}
            />
            <View style={adminStyles.actions}>
              <TouchableOpacity
                style={[adminStyles.action, adminStyles.actionGhost]}
                onPress={() => setRefunding(null)}>
                <Text style={adminStyles.actionGhostText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[adminStyles.action, adminStyles.actionDestructive]}
                disabled={refund.isPending}
                onPress={submitRefund}>
                <Text style={adminStyles.actionDestructiveText}>Send refund</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          (actions.length > 0 || refundable) && (
            <View style={adminStyles.actions}>
              {actions.map((action) => (
                <TouchableOpacity
                  key={action.to}
                  style={[
                    adminStyles.action,
                    action.destructive ? adminStyles.actionGhost : adminStyles.actionPrimary,
                  ]}
                  disabled={transition.isPending}
                  onPress={() => onActionPress(item.order_id, action)}>
                  <Text
                    style={
                      action.destructive
                        ? adminStyles.actionGhostText
                        : adminStyles.actionPrimaryText
                    }>
                    {action.label}
                  </Text>
                </TouchableOpacity>
              ))}
              {refundable && (
                <TouchableOpacity
                  style={[adminStyles.action, adminStyles.actionDestructive]}
                  onPress={() => openRefund(item)}>
                  <Text style={adminStyles.actionDestructiveText}>Refund</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        )}
      </View>
    );
  };

  return (
    <AdminScreen title="Orders" subtitle={`${orders?.length ?? 0} shown`}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={Colors.muted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Restaurant, customer or email"
          placeholderTextColor={Colors.muted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={Colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        horizontal
        data={ADMIN_ORDER_FILTERS}
        keyExtractor={(item) => item.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={adminStyles.chipRow}
        style={styles.filterList}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[adminStyles.chip, item.key === filterKey && adminStyles.chipActive]}
            onPress={() => setFilterKey(item.key)}>
            <Text
              style={[adminStyles.chipText, item.key === filterKey && adminStyles.chipTextActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
      />

      {isLoading ? (
        <ActivityIndicator size="large" color={Colors.secondary} style={styles.loader} />
      ) : (
        <FlatList
          data={orders ?? []}
          keyExtractor={(item) => item.order_id}
          renderItem={renderOrder}
          contentContainerStyle={adminStyles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={Colors.secondary}
            />
          }
          ListEmptyComponent={
            <AdminEmpty
              icon="receipt-outline"
              title="Nothing here"
              text="No order matches this filter right now."
            />
          }
        />
      )}
    </AdminScreen>
  );
};

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginTop: 12,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: '#000' },
  filterList: { flexGrow: 0 },
  loader: { marginTop: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ececec',
    paddingTop: 8,
    marginTop: 2,
  },
  totalLabel: { fontSize: 14, fontWeight: '600', color: '#000' },
  totalValue: { fontSize: 15, fontWeight: '700', color: '#000' },
  panel: { gap: 8, marginTop: 4 },
});

export default Page;
