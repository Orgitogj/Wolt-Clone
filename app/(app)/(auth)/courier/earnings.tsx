import { Colors } from '@/constants/theme';
import { useCourierEarnings } from '@/hooks/useCourier';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const Page = () => {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const { earnings, deliveries, total, tips, count, isLoading } = useCourierEarnings();
  const { data: settings } = usePlatformSettings();

  const currency = settings?.currency === 'EUR' ? '€' : (settings?.currency ?? '');
  const deliveryById = new Map(deliveries.map((delivery) => [delivery.id, delivery]));

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: top + 8 }]}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#000" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Earnings</Text>
          <Text style={styles.subtitle}>{count} deliveries completed</Text>
        </View>
        <View style={styles.iconButton} />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.secondary} />
        </View>
      ) : (
        <FlatList
          data={earnings}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.summary}>
              <View style={styles.summaryBlock}>
                <Text style={styles.summaryValue}>
                  {total.toFixed(2)} {currency}
                </Text>
                <Text style={styles.summaryLabel}>Total earned</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryBlock}>
                <Text style={styles.summaryValue}>
                  {tips.toFixed(2)} {currency}
                </Text>
                <Text style={styles.summaryLabel}>From tips</Text>
              </View>
            </View>
          }
          renderItem={({ item }) => {
            const delivery = deliveryById.get(item.delivery_id);
            return (
              <View style={styles.row}>
                <View style={styles.rowLeft}>
                  <Text style={styles.rowTitle}>
                    {delivery?.restaurant?.name ?? 'Delivery'}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {new Date(item.created_at).toLocaleDateString()}
                    {delivery?.distance_km != null
                      ? ` • ${Number(delivery.distance_km).toFixed(1)} km`
                      : ''}
                  </Text>
                  {Number(item.tip) > 0 && (
                    <Text style={styles.rowTip}>
                      includes {Number(item.tip).toFixed(2)} {currency} tip
                    </Text>
                  )}
                </View>
                <Text style={styles.rowAmount}>
                  {Number(item.total).toFixed(2)} {currency}
                </Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="wallet-outline" size={48} color={Colors.muted} />
              <Text style={styles.emptyTitle}>No earnings yet</Text>
              <Text style={styles.emptyText}>
                Completed deliveries and tips show up here.
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
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
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
  iconButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerText: { flex: 1, alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: '#000' },
  subtitle: { fontSize: 13, color: Colors.muted, marginTop: 2 },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
  summary: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    marginBottom: 12,
    alignItems: 'center',
  },
  summaryBlock: { flex: 1, alignItems: 'center', gap: 4 },
  summaryDivider: { width: StyleSheet.hairlineWidth, height: 36, backgroundColor: '#e0e0e0' },
  summaryValue: { fontSize: 22, fontWeight: '700', color: '#000' },
  summaryLabel: { fontSize: 12, color: Colors.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
  },
  rowLeft: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: '#000' },
  rowMeta: { fontSize: 13, color: Colors.muted },
  rowTip: { fontSize: 12, color: Colors.secondary, fontWeight: '600' },
  rowAmount: { fontSize: 16, fontWeight: '700', color: '#000' },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#000', marginTop: 8 },
  emptyText: { fontSize: 14, color: Colors.muted, textAlign: 'center' },
});

export default Page;
