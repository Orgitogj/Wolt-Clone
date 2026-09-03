import { AdminScreen, adminStyles } from '@/components/admin/AdminScreen';
import { Colors } from '@/constants/theme';
import {
  useAdminActions,
  useAdminCouriers,
  useAdminOverview,
  useAdminRevenue,
  useAssignDelivery,
  useIsAdmin,
  useUnassignedDeliveries,
} from '@/hooks/useAdmin';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { formatMoney } from '@/utils/currency';
import type { AdminCourier, DeliveryWithContext } from '@/types/database';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const NAV = [
  { href: '/admin/orders', icon: 'receipt-outline', title: 'Orders', text: 'Every order on the platform' },
  { href: '/admin/couriers', icon: 'bicycle-outline', title: 'Couriers', text: 'Applications and fleet' },
  { href: '/admin/users', icon: 'people-outline', title: 'People', text: 'Roles and restaurant access' },
  { href: '/admin/settings', icon: 'options-outline', title: 'Settings', text: 'Fees, limits and payments' },
] as const;

const Page = () => {
  const router = useRouter();
  const { isAdmin } = useIsAdmin();
  const { data: settings } = usePlatformSettings();
  const { data: overview, isLoading, refetch, isRefetching } = useAdminOverview(isAdmin);
  const { data: revenue } = useAdminRevenue(isAdmin);
  const { data: deliveries } = useUnassignedDeliveries(isAdmin);
  const { data: couriers } = useAdminCouriers(isAdmin);
  const { data: actions } = useAdminActions(isAdmin);
  const assign = useAssignDelivery();

  const [assigning, setAssigning] = useState<string | null>(null);

  const currency = settings?.currency;
  const pending = (deliveries ?? []).filter((delivery) => delivery.status === 'pending');
  const available = (couriers ?? []).filter(
    (courier) => courier.verification_status === 'approved' && courier.availability !== 'busy'
  );

  const onAssign = async (delivery: DeliveryWithContext, courier: AdminCourier) => {
    try {
      await assign.mutateAsync({ deliveryId: delivery.id, courierId: courier.id });
      setAssigning(null);
    } catch (error) {
      Alert.alert(
        'Could not assign',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  };

  const stats = overview
    ? [
        { label: 'Orders today', value: String(overview.orders_today) },
        { label: 'GMV today', value: formatMoney(overview.gmv_today, currency) },
        { label: 'Commission', value: formatMoney(overview.commission_today, currency) },
        { label: 'Refunds', value: formatMoney(overview.refunds_today, currency) },
        { label: 'Live orders', value: String(overview.active_orders) },
        { label: 'Awaiting payment', value: String(overview.awaiting_payment) },
        { label: 'Couriers online', value: String(overview.online_couriers) },
        { label: 'Applications', value: String(overview.pending_couriers) },
      ]
    : [];

  return (
    <AdminScreen title="Admin" subtitle="Platform overview">
      <ScrollView
        contentContainerStyle={adminStyles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.secondary} />
        }>
        {isLoading ? (
          <ActivityIndicator size="large" color={Colors.secondary} style={styles.loader} />
        ) : (
          <View style={styles.statGrid}>
            {stats.map((stat) => (
              <View key={stat.label} style={styles.stat}>
                <Text style={styles.statValue}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={adminStyles.sectionTitle}>DISPATCH QUEUE</Text>
        {pending.length === 0 ? (
          <View style={adminStyles.card}>
            <Text style={adminStyles.cardMeta}>
              No delivery is waiting for a courier. Automatic dispatch is keeping up.
            </Text>
          </View>
        ) : (
          pending.map((delivery) => (
            <View key={delivery.id} style={adminStyles.card}>
              <View style={adminStyles.cardHeader}>
                <Text style={adminStyles.cardTitle}>
                  {delivery.restaurant?.name ?? 'Restaurant'}
                </Text>
                <Text style={adminStyles.cardMeta}>
                  {delivery.offer_attempts} offer{delivery.offer_attempts === 1 ? '' : 's'}
                </Text>
              </View>
              <Text style={adminStyles.cardMeta}>
                {delivery.dropoff_address ?? 'Delivery address'}
                {delivery.distance_km ? ` • ${Number(delivery.distance_km).toFixed(1)} km` : ''}
              </Text>

              {assigning === delivery.id ? (
                available.length === 0 ? (
                  <Text style={adminStyles.cardMeta}>No approved courier is free right now.</Text>
                ) : (
                  <View style={styles.courierPicker}>
                    {available.map((courier) => (
                      <TouchableOpacity
                        key={courier.id}
                        style={styles.courierOption}
                        disabled={assign.isPending}
                        onPress={() => onAssign(delivery, courier)}>
                        <Ionicons name="person-circle-outline" size={20} color={Colors.secondary} />
                        <View style={styles.courierBody}>
                          <Text style={adminStyles.cardTitle}>{courier.full_name}</Text>
                          <Text style={adminStyles.cardMeta}>
                            {courier.vehicle_type.replace('_', ' ')} • {courier.availability}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      style={[adminStyles.action, adminStyles.actionGhost]}
                      onPress={() => setAssigning(null)}>
                      <Text style={adminStyles.actionGhostText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                )
              ) : (
                <TouchableOpacity
                  style={[adminStyles.action, adminStyles.actionPrimary]}
                  onPress={() => setAssigning(delivery.id)}>
                  <Text style={adminStyles.actionPrimaryText}>Assign a courier</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}

        <Text style={adminStyles.sectionTitle}>MANAGE</Text>
        {NAV.map((item) => (
          <TouchableOpacity
            key={item.href}
            style={styles.navCard}
            onPress={() => router.push(item.href)}>
            <View style={styles.navIcon}>
              <Ionicons name={item.icon} size={20} color={Colors.secondary} />
            </View>
            <View style={styles.navBody}>
              <Text style={adminStyles.cardTitle}>{item.title}</Text>
              <Text style={adminStyles.cardMeta}>{item.text}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>
        ))}

        {(revenue ?? []).length > 0 && (
          <>
            <Text style={adminStyles.sectionTitle}>LAST 30 DAYS</Text>
            <View style={adminStyles.card}>
              {(revenue ?? []).slice(0, 10).map((day) => (
                <View key={day.day} style={styles.revenueRow}>
                  <Text style={adminStyles.cardMeta}>
                    {new Date(day.day).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </Text>
                  <Text style={adminStyles.cardMeta}>{day.orders} orders</Text>
                  <Text style={adminStyles.cardTitle}>{formatMoney(day.gmv, currency)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {(actions ?? []).length > 0 && (
          <>
            <Text style={adminStyles.sectionTitle}>RECENT ADMIN ACTIVITY</Text>
            <View style={adminStyles.card}>
              {(actions ?? []).slice(0, 8).map((entry) => (
                <View key={entry.id} style={styles.actionRow}>
                  <Text style={adminStyles.cardTitle}>{entry.action.replace(/_/g, ' ')}</Text>
                  <Text style={adminStyles.cardMeta}>
                    {entry.subject_type} • {new Date(entry.created_at).toLocaleString()}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </AdminScreen>
  );
};

const styles = StyleSheet.create({
  loader: { marginVertical: 24 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  statValue: { fontSize: 20, fontWeight: '800', color: '#000' },
  statLabel: { fontSize: 12, color: Colors.muted },
  navCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.primaryLight,
    borderRadius: 12,
    padding: 14,
  },
  navIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBody: { flex: 1, gap: 2 },
  courierPicker: { gap: 8, marginTop: 4 },
  courierOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f7f7f7',
    borderRadius: 10,
    padding: 10,
  },
  courierBody: { flex: 1, gap: 2 },
  revenueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececec',
  },
  actionRow: {
    paddingVertical: 6,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececec',
  },
});

export default Page;
