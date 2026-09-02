import { OrderStatusBadge } from '@/components/OrderStatusBadge';
import { MERCHANT_ACTIONS, type MerchantAction } from '@/constants/orderStatus';
import { Colors } from '@/constants/theme';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { useManagedRestaurants, useMerchantOrders, useTransitionOrder } from '@/hooks/useMerchant';
import type { MerchantOrder } from '@/types/database';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface PendingAction {
  orderId: string;
  action: MerchantAction;
}

const Page = () => {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const { restaurants, isLoading: restaurantsLoading } = useManagedRestaurants();
  const { data: settings } = usePlatformSettings();

  const [restaurantId, setRestaurantId] = useState<string | undefined>(undefined);
  const [showHistory, setShowHistory] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!restaurantId && restaurants.length > 0) setRestaurantId(restaurants[0].id);
  }, [restaurantId, restaurants]);

  const {
    data: orders,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useMerchantOrders(restaurantId, showHistory);
  const transition = useTransitionOrder(restaurantId);

  const currency = settings?.currency === 'EUR' ? '€' : (settings?.currency ?? '');

  const runAction = async (orderId: string, action: MerchantAction, note?: string | null) => {
    try {
      await transition.mutateAsync({ orderId, to: action.to, reason: note ?? null });
      setPending(null);
      setReason('');
    } catch (err) {
      Alert.alert('Could not update order', err instanceof Error ? err.message : 'Please try again.');
    }
  };

  const onActionPress = (orderId: string, action: MerchantAction) => {
    if (action.requiresReason) {
      setPending({ orderId, action });
      setReason('');
      return;
    }
    runAction(orderId, action);
  };

  const renderOrder = ({ item }: { item: MerchantOrder }) => {
    const actions = MERCHANT_ACTIONS[item.status] ?? [];
    const isPending = pending?.orderId === item.id;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text style={styles.orderId}>#{item.id.slice(0, 8)}</Text>
            <Text style={styles.time}>
              {new Date(item.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
          <OrderStatusBadge status={item.status} />
        </View>

        <View style={styles.items}>
          {item.order_items?.map((line) => (
            <View key={line.id} style={styles.itemRow}>
              <Text style={styles.itemQty}>{line.quantity}×</Text>
              <View style={styles.itemBody}>
                <Text style={styles.itemName}>{line.dish_name}</Text>
                {line.addons?.length > 0 && (
                  <Text style={styles.itemAddons}>
                    {line.addons.map((addon) => addon.name).join(', ')}
                  </Text>
                )}
              </View>
              <Text style={styles.itemPrice}>
                {Number(line.line_total).toFixed(2)} {currency}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.metaRow}>
          <Ionicons
            name={item.delivery_mode === 'pickup' ? 'bag-handle-outline' : 'bicycle-outline'}
            size={15}
            color={Colors.muted}
          />
          <Text style={styles.meta}>
            {item.delivery_mode === 'pickup'
              ? 'Pickup'
              : (item.address?.address_line ?? 'Delivery')}
          </Text>
        </View>

        {item.scheduled_for && (
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={15} color={Colors.muted} />
            <Text style={styles.meta}>
              Scheduled for {new Date(item.scheduled_for).toLocaleString()}
            </Text>
          </View>
        )}

        {item.leave_at_door && (
          <View style={styles.metaRow}>
            <Ionicons name="home-outline" size={15} color={Colors.muted} />
            <Text style={styles.meta}>Leave at the door</Text>
          </View>
        )}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            {Number(item.total).toFixed(2)} {currency}
          </Text>
        </View>

        {isPending ? (
          <View style={styles.reasonBox}>
            <Text style={styles.reasonLabel}>Why are you {pending.action.label.toLowerCase()}ing?</Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Reason for the customer"
              placeholderTextColor={Colors.muted}
              value={reason}
              onChangeText={setReason}
              autoFocus
            />
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.action, styles.actionGhost]}
                onPress={() => setPending(null)}>
                <Text style={styles.actionGhostText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.action, styles.actionDestructive]}
                disabled={transition.isPending}
                onPress={() => runAction(item.id, pending.action, reason.trim() || null)}>
                <Text style={styles.actionDestructiveText}>
                  Confirm {pending.action.label.toLowerCase()}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          actions.length > 0 && (
            <View style={styles.actions}>
              {actions.map((action) => (
                <TouchableOpacity
                  key={action.to}
                  style={[styles.action, action.destructive ? styles.actionGhost : styles.actionPrimary]}
                  disabled={transition.isPending}
                  onPress={() => onActionPress(item.id, action)}>
                  <Text
                    style={
                      action.destructive ? styles.actionGhostText : styles.actionPrimaryText
                    }>
                    {action.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )
        )}
      </View>
    );
  };

  if (restaurantsLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.secondary} />
      </View>
    );
  }

  if (restaurants.length === 0) {
    return (
      <View style={[styles.centered, { paddingTop: top }]}>
        <Ionicons name="storefront-outline" size={52} color={Colors.muted} />
        <Text style={styles.emptyTitle}>No restaurant linked</Text>
        <Text style={styles.emptyText}>
          This account does not manage a restaurant yet. An administrator has to add you as a member
          before orders appear here.
        </Text>
        <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const activeRestaurant = restaurants.find((r) => r.id === restaurantId);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: top + 8 }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#000" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>{activeRestaurant?.name ?? 'Orders'}</Text>
          <Text style={styles.subtitle}>{showHistory ? 'Completed orders' : 'Live orders'}</Text>
        </View>
        <View style={styles.backButton} />
      </View>

      {restaurants.length > 1 && (
        <FlatList
          horizontal
          data={restaurants}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.chip, item.id === restaurantId && styles.chipActive]}
              onPress={() => setRestaurantId(item.id)}>
              <Text style={[styles.chipText, item.id === restaurantId && styles.chipTextActive]}>
                {item.name}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, !showHistory && styles.tabActive]}
          onPress={() => setShowHistory(false)}>
          <Text style={[styles.tabText, !showHistory && styles.tabTextActive]}>Active</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, showHistory && styles.tabActive]}
          onPress={() => setShowHistory(true)}>
          <Text style={[styles.tabText, showHistory && styles.tabTextActive]}>History</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.secondary} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Could not load orders. Pull to retry.</Text>
        </View>
      ) : (
        <FlatList
          data={orders ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderOrder}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.secondary} />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="receipt-outline" size={48} color={Colors.muted} />
              <Text style={styles.emptyTitle}>
                {showHistory ? 'No completed orders' : 'No live orders'}
              </Text>
              <Text style={styles.emptyText}>
                {showHistory
                  ? 'Orders appear here once they are delivered or cancelled.'
                  : 'New orders show up here as soon as customers place them.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
    gap: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e6e6e6',
  },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerText: { flex: 1, alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: '#000' },
  subtitle: { fontSize: 13, color: Colors.muted, marginTop: 2 },
  chipRow: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  chipActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  chipText: { fontSize: 13, color: '#000', fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  tabActive: { backgroundColor: Colors.primaryLight },
  tabText: { fontSize: 14, fontWeight: '600', color: Colors.muted },
  tabTextActive: { color: Colors.secondary },
  list: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 8 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeaderLeft: { gap: 2 },
  orderId: { fontSize: 15, fontWeight: '700', color: '#000' },
  time: { fontSize: 12, color: Colors.muted },
  items: { gap: 8, paddingVertical: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  itemQty: { fontSize: 14, fontWeight: '700', color: Colors.secondary, minWidth: 26 },
  itemBody: { flex: 1 },
  itemName: { fontSize: 14, color: '#000', fontWeight: '600' },
  itemAddons: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  itemPrice: { fontSize: 14, color: '#000' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { fontSize: 13, color: Colors.muted, flex: 1 },
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
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  action: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  actionPrimary: { backgroundColor: Colors.secondary },
  actionPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  actionGhost: { backgroundColor: '#f4f4f4' },
  actionGhostText: { color: Colors.muted, fontSize: 14, fontWeight: '700' },
  actionDestructive: { backgroundColor: '#fbe9e9' },
  actionDestructiveText: { color: '#c1272d', fontSize: 14, fontWeight: '700' },
  reasonBox: { gap: 8, marginTop: 4 },
  reasonLabel: { fontSize: 13, color: Colors.muted },
  reasonInput: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#000',
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#000', marginTop: 10 },
  emptyText: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
  backLink: { marginTop: 14 },
  backLinkText: { color: Colors.secondary, fontSize: 15, fontWeight: '600' },
});

export default Page;
