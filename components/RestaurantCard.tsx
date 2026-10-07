import { Colors } from '@/constants/theme';
import type { Restaurant } from '@/types/database';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface RestaurantCardProps {
  restaurant: Restaurant;
  onPress: () => void;
}

const RestaurantCard = ({ restaurant, onPress }: RestaurantCardProps) => (
  <TouchableOpacity
    style={styles.card}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={restaurant.name}
    testID={`restaurant-card-${restaurant.id}`}>
    <Image source={{ uri: restaurant.image_url ?? undefined }} style={styles.image} />
    <View style={styles.info}>
      <Text style={styles.name}>{restaurant.name}</Text>
      <Text style={styles.description} numberOfLines={2}>
        {restaurant.description}
      </Text>
    </View>
    <View style={styles.metadata}>
      <Ionicons name="star" size={14} color="#f5a623" />
      <Text style={styles.metadataText}>{restaurant.rating.toFixed(1)}</Text>
      <Text style={styles.dot}>•</Text>
      <Ionicons name="time-outline" size={16} color={Colors.muted} />
      <Text style={styles.metadataText}>
        {restaurant.delivery_time_min}-{restaurant.delivery_time_max} min
      </Text>
      <Text style={styles.dot}>•</Text>
      <Ionicons name="bicycle-outline" size={16} color={Colors.muted} />
      <Text style={styles.metadataText}>{restaurant.delivery_fee.toFixed(2)} €</Text>
      {!restaurant.is_open && (
        <>
          <Text style={styles.dot}>•</Text>
          <Text style={styles.closedText}>Closed</Text>
        </>
      )}
    </View>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light,
    overflow: 'hidden',
    boxShadow: '0px 4px 2px -2px rgba(0,0,0, 0.2)',
    elevation: 2,
    backgroundColor: '#fff',
  },
  image: {
    width: '100%',
    height: 180,
  },
  info: {
    padding: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
    color: Colors.muted,
  },
  metadata: {
    borderTopColor: Colors.light,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 10,
  },
  metadataText: {
    fontSize: 13,
    color: Colors.muted,
  },
  dot: {
    color: '#999',
    fontSize: 13,
  },
  closedText: {
    fontSize: 13,
    color: '#ff4646',
    fontWeight: '600',
  },
});

export default RestaurantCard;
