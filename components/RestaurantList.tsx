import { Colors } from '@/constants/theme';
import type { Restaurant } from '@/types/database';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface RestaurantListProps {
  restaurants: Restaurant[];
  isLoading?: boolean;
  error?: unknown;
  emptyMessage?: string;
}

const RestaurantList = ({ restaurants, isLoading, error, emptyMessage }: RestaurantListProps) => {
  if (isLoading) {
    return (
      <View style={{ paddingVertical: 24 }}>
        <ActivityIndicator size={'large'} color={Colors.secondary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ padding: 16, alignItems: 'center' }}>
        <Text style={{ color: Colors.dark, marginBottom: 8 }}>Failed to load restaurants</Text>
        <Text style={{ color: Colors.muted }}>
          {error instanceof Error ? error.message : 'Please try again later'}
        </Text>
      </View>
    );
  }

  if (restaurants.length === 0) {
    return (
      <View style={{ padding: 24, alignItems: 'center' }}>
        <Ionicons name="restaurant-outline" size={40} color={Colors.muted} />
        <Text style={{ color: Colors.muted, marginTop: 8, textAlign: 'center' }}>
          {emptyMessage ?? 'No restaurants match right now.'}
        </Text>
      </View>
    );
  }

  return (
    <>
      {restaurants.map((item) => (
        <View key={item.id}>
          <Link href={`/(modal)/(restaurant)/${item.id}`} asChild>
            <TouchableOpacity style={styles.card}>
              <Image source={{ uri: item.image_url ?? undefined }} style={styles.image} />
              <View style={styles.info}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.description} numberOfLines={2}>
                  {item.description}
                </Text>
              </View>
              <View style={styles.metadata}>
                <Ionicons name="star" size={14} color="#f5a623" />
                <Text style={styles.metadataText}>{item.rating.toFixed(1)}</Text>
                <Text style={styles.dot}>•</Text>
                <Ionicons name="time-outline" size={16} color={Colors.muted} />
                <Text style={styles.metadataText}>
                  {item.delivery_time_min}-{item.delivery_time_max} min
                </Text>
                <Text style={styles.dot}>•</Text>
                <Ionicons name="bicycle-outline" size={16} color={Colors.muted} />
                <Text style={styles.metadataText}>{item.delivery_fee.toFixed(2)} €</Text>
                {!item.is_open && (
                  <>
                    <Text style={styles.dot}>•</Text>
                    <Text style={styles.closedText}>Closed</Text>
                  </>
                )}
              </View>
            </TouchableOpacity>
          </Link>
        </View>
      ))}
    </>
  );
};

const styles = StyleSheet.create({
  card: {
    margin: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light,
    overflow: 'hidden',
    boxShadow: '0px 4px 2px -2px rgba(0,0,0, 0.2)',
    elevation: 2,
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
export default RestaurantList;
