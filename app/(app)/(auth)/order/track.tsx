import { OrderStatusBadge } from '@/components/OrderStatusBadge';
import { DELIVERY_STATUS_LABELS } from '@/constants/deliveryStatus';
import { orderStatusLabel } from '@/constants/orderStatus';
import { Colors } from '@/constants/theme';
import { useOrderTracking } from '@/hooks/useOrderTracking';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MAP_HEIGHT = 300;

const Page = () => {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const { data: settings } = usePlatformSettings();

  const { order, delivery, history, courier, courierPosition, isLive, isLoading } =
    useOrderTracking(id);

  const currency = settings?.currency === 'EUR' ? '€' : (settings?.currency ?? '');

  const courierLat = courierPosition?.latitude;
  const courierLon = courierPosition?.longitude;

  useEffect(() => {
    if (courierLat == null || courierLon == null || !mapRef.current) return;
    mapRef.current.animateToRegion(
      {
        latitude: courierLat,
        longitude: courierLon,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      },
      600
    );
  }, [courierLat, courierLon]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.secondary} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.centered}>
        <Ionicons name="receipt-outline" size={48} color={Colors.muted} />
        <Text style={styles.emptyTitle}>Order not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const initialRegion = {
    latitude:
      courierPosition?.latitude ??
      delivery?.dropoff_latitude ??
      delivery?.pickup_latitude ??
      51.9625,
    longitude:
      courierPosition?.longitude ??
      delivery?.dropoff_longitude ??
      delivery?.pickup_longitude ??
      7.6257,
    latitudeDelta: 0.03,
    longitudeDelta: 0.03,
  };

  const showMap =
    order.delivery_mode === 'delivery' &&
    (delivery?.pickup_latitude != null || delivery?.dropoff_latitude != null);

  return (
    <View style={styles.container}>
      {showMap ? (
        <View style={styles.mapWrapper}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
            initialRegion={initialRegion}
            showsUserLocation={false}
            toolbarEnabled={false}>
            {delivery?.pickup_latitude != null && delivery?.pickup_longitude != null && (
              <Marker
                coordinate={{
                  latitude: delivery.pickup_latitude,
                  longitude: delivery.pickup_longitude,
                }}
                title={order.restaurant?.name ?? 'Restaurant'}
                pinColor="#F0A202"
              />
            )}
            {delivery?.dropoff_latitude != null && delivery?.dropoff_longitude != null && (
              <Marker
                coordinate={{
                  latitude: delivery.dropoff_latitude,
                  longitude: delivery.dropoff_longitude,
                }}
                title="Your address"
                pinColor={Colors.secondary}
              />
            )}
            {courierPosition && (
              <Marker
                coordinate={{
                  latitude: courierPosition.latitude,
                  longitude: courierPosition.longitude,
                }}
                title={courier?.full_name ?? 'Courier'}
                pinColor="#1DB954"
              />
            )}
          </MapView>

          <TouchableOpacity
            style={[styles.backFloating, { top: insets.top + 8 }]}
            onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={22} color="#000" />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color="#000" />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.title}>Order #{order.id.slice(0, 8)}</Text>
            <Text style={styles.subtitle}>{order.restaurant?.name}</Text>
          </View>
          <View style={styles.iconButton} />
        </View>
      )}

      <ScrollView
        style={styles.sheet}
        contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.statusRow}>
          <View style={styles.statusLeft}>
            <Text style={styles.restaurant}>{order.restaurant?.name ?? 'Restaurant'}</Text>
            <Text style={styles.statusHint}>
              {delivery && isLive
                ? DELIVERY_STATUS_LABELS[delivery.status]
                : orderStatusLabel(order.status)}
            </Text>
          </View>
          <OrderStatusBadge status={order.status} />
        </View>

        {courier && isLive && (
          <View style={styles.courierCard}>
            <View style={styles.courierAvatar}>
              <Ionicons name="bicycle" size={20} color={Colors.secondary} />
            </View>
            <View style={styles.courierText}>
              <Text style={styles.courierName}>{courier.full_name}</Text>
              <Text style={styles.courierMeta}>
                {courierPosition
                  ? `Updated ${new Date(courierPosition.recorded_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : 'Waiting for location'}
              </Text>
            </View>
            <View style={styles.liveDot} />
          </View>
        )}

        <View style={styles.timeline}>
          {history.map((entry, index) => (
            <View key={entry.id} style={styles.timelineRow}>
              <View style={styles.timelineMarkerColumn}>
                <View
                  style={[
                    styles.timelineDot,
                    index === history.length - 1 && styles.timelineDotCurrent,
                  ]}
                />
                {index < history.length - 1 && <View style={styles.timelineLine} />}
              </View>
              <View style={styles.timelineBody}>
                <Text style={styles.timelineLabel}>{orderStatusLabel(entry.to_status)}</Text>
                <Text style={styles.timelineTime}>
                  {new Date(entry.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
                {entry.reason && <Text style={styles.timelineReason}>{entry.reason}</Text>}
              </View>
            </View>
          ))}
        </View>

        <View style={styles.itemsCard}>
          <Text style={styles.sectionTitle}>Your order</Text>
          {order.order_items?.map((line) => (
            <View key={line.id} style={styles.itemRow}>
              <Text style={styles.itemQty}>{line.quantity}×</Text>
              <Text style={styles.itemName}>{line.dish_name}</Text>
              <Text style={styles.itemPrice}>
                {Number(line.line_total).toFixed(2)} {currency}
              </Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>
              {Number(order.total).toFixed(2)} {currency}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, padding: 24 },
  mapWrapper: { height: MAP_HEIGHT, backgroundColor: '#e9eef1' },
  backFloating: {
    position: 'absolute',
    left: 12,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    boxShadow: '0px 2px 6px rgba(0, 0, 0, 0.18)',
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
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: '#000' },
  subtitle: { fontSize: 13, color: Colors.muted, marginTop: 2 },
  sheet: { flex: 1 },
  sheetContent: { padding: 16, gap: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusLeft: { flex: 1, gap: 2 },
  restaurant: { fontSize: 20, fontWeight: '700', color: '#000' },
  statusHint: { fontSize: 14, color: Colors.muted },
  courierCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
  },
  courierAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  courierText: { flex: 1 },
  courierName: { fontSize: 15, fontWeight: '700', color: '#000' },
  courierMeta: { fontSize: 13, color: Colors.muted, marginTop: 2 },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#1DB954' },
  timeline: { backgroundColor: '#fff', borderRadius: 14, padding: 16 },
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineMarkerColumn: { alignItems: 'center', width: 16 },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#d5dde2',
    marginTop: 5,
  },
  timelineDotCurrent: { backgroundColor: Colors.secondary },
  timelineLine: { flex: 1, width: 2, backgroundColor: '#e7edf0', marginVertical: 2 },
  timelineBody: { flex: 1, paddingBottom: 14 },
  timelineLabel: { fontSize: 14, fontWeight: '600', color: '#000' },
  timelineTime: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  timelineReason: { fontSize: 13, color: Colors.muted, marginTop: 4, fontStyle: 'italic' },
  itemsCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#000', marginBottom: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemQty: { fontSize: 14, fontWeight: '700', color: Colors.secondary, minWidth: 26 },
  itemName: { flex: 1, fontSize: 14, color: '#000' },
  itemPrice: { fontSize: 14, color: '#000' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ececec',
    paddingTop: 10,
    marginTop: 4,
  },
  totalLabel: { fontSize: 15, fontWeight: '600', color: '#000' },
  totalValue: { fontSize: 16, fontWeight: '700', color: '#000' },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#000' },
  link: { color: Colors.secondary, fontSize: 15, fontWeight: '600', marginTop: 8 },
});

export default Page;
