import { ReviewManagementList } from '@/components/reviews/ReviewManagementList';
import { Colors } from '@/constants/theme';
import { useManagedRestaurants } from '@/hooks/useMerchant';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const Page = () => {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { restaurants, isLoading } = useManagedRestaurants();

  const restaurantId = id ?? restaurants[0]?.id ?? null;
  const restaurant = restaurants.find((item) => item.id === restaurantId);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: top }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {restaurant?.name ?? 'Reviews'}
        </Text>
        <View style={styles.spacer} />
      </View>

      {isLoading ? (
        <View style={styles.state} testID="merchant-reviews-loading">
          <ActivityIndicator color={Colors.secondary} />
        </View>
      ) : !restaurantId ? (
        <View style={styles.state}>
          <Text style={styles.mutedText}>You do not manage a restaurant yet.</Text>
        </View>
      ) : (
        <ReviewManagementList restaurantId={restaurantId} canRespond />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#000' },
  spacer: { width: 40 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  mutedText: { fontSize: 14, color: Colors.muted, textAlign: 'center' },
});

export default Page;
