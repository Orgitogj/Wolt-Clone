import { Colors } from '@/constants/theme';
import { useActivePromotions } from '@/hooks/usePromotions';
import { describePromotion } from '@/services/promotionService';
import type { Promotion } from '@/types/database';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface OfferListProps {
  restaurantId?: string | null;
  title?: string;
}

const formatEnds = (promotion: Promotion) => {
  if (!promotion.ends_at) return null;
  return `Ends ${new Date(promotion.ends_at).toLocaleDateString()}`;
};

export const OfferList = ({ restaurantId, title = 'Offers' }: OfferListProps) => {
  const { data, isLoading, error, refetch } = useActivePromotions(restaurantId);

  if (isLoading) {
    return (
      <View style={styles.section}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.state} testID="offers-loading">
          <ActivityIndicator color={Colors.secondary} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.section}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.state}>
          <Text style={styles.mutedText}>We could not load offers.</Text>
          <TouchableOpacity onPress={() => refetch()} accessibilityRole="button">
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const promotions = data ?? [];

  if (promotions.length === 0) {
    return null;
  }

  return (
    <View style={styles.section} testID="offers-section">
      <Text style={styles.title}>{title}</Text>
      <FlatList
        horizontal
        data={promotions}
        keyExtractor={(promotion) => promotion.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card} testID={`offer-${item.code}`}>
            <View style={styles.cardHeader}>
              <Ionicons name="pricetag" size={14} color={Colors.secondary} />
              <Text style={styles.code}>{item.code}</Text>
            </View>
            <Text style={styles.headline}>{describePromotion(item)}</Text>
            {!!item.description && (
              <Text style={styles.description} numberOfLines={2}>
                {item.description}
              </Text>
            )}
            {!!formatEnds(item) && <Text style={styles.terms}>{formatEnds(item)}</Text>}
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginBottom: 24 },
  title: {
    fontSize: 20,
    fontWeight: '700',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  list: { paddingHorizontal: 16, gap: 12 },
  state: { paddingHorizontal: 16, gap: 6 },
  mutedText: { fontSize: 13, color: Colors.muted },
  retryText: { fontSize: 13, fontWeight: '700', color: Colors.secondary },
  card: {
    width: 220,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  code: { fontSize: 13, fontWeight: '800', color: Colors.secondary, letterSpacing: 0.5 },
  headline: { fontSize: 16, fontWeight: '700', color: '#000' },
  description: { fontSize: 13, color: Colors.muted },
  terms: { fontSize: 12, color: Colors.muted },
});
