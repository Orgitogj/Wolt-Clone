import { Colors } from '@/constants/theme';
import { useDishSearch } from '@/hooks/useMenu';
import { useRestaurants } from '@/hooks/useRestaurants';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const Search = () => {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const {
    data: restaurants,
    isLoading: restaurantsLoading,
    error: restaurantsError,
  } = useRestaurants({ search: debouncedQuery || undefined });

  const { data: dishes, isLoading: dishesLoading } = useDishSearch(debouncedQuery);

  const isSearching = debouncedQuery.length > 0;
  const isLoading = restaurantsLoading || (isSearching && dishesLoading);
  const hasNoResults =
    isSearching && !isLoading && (restaurants ?? []).length === 0 && (dishes ?? []).length === 0;

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color={Colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search restaurants, dishes or cuisines"
          style={styles.input}
          placeholderTextColor={Colors.muted}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={Colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.secondary} />
        </View>
      ) : restaurantsError ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Failed to search. Please try again.</Text>
        </View>
      ) : hasNoResults ? (
        <View style={styles.centered}>
          <Ionicons name="search-outline" size={40} color={Colors.muted} />
          <Text style={styles.emptyText}>No results for &quot;{debouncedQuery}&quot;.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {(restaurants ?? []).length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Restaurants</Text>
              {(restaurants ?? []).map((restaurant) => (
                <TouchableOpacity
                  key={restaurant.id}
                  style={styles.card}
                  onPress={() => router.push(`/(modal)/(restaurant)/${restaurant.id}`)}>
                  <Image source={{ uri: restaurant.image_url ?? undefined }} style={styles.image} />
                  <View style={styles.cardContent}>
                    <Text style={styles.name}>{restaurant.name}</Text>
                    <Text style={styles.description} numberOfLines={2}>
                      {restaurant.description}
                    </Text>
                    <Text style={styles.meta}>
                      {restaurant.cuisines.join(' • ')} • {restaurant.delivery_time_min}-
                      {restaurant.delivery_time_max} min
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}

          {isSearching && (dishes ?? []).length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Dishes</Text>
              {(dishes ?? []).map((dish) => (
                <TouchableOpacity
                  key={dish.id}
                  style={styles.card}
                  onPress={() => router.push(`/(modal)/(menu)/${dish.id}`)}>
                  <Image source={{ uri: dish.image_url ?? undefined }} style={styles.image} />
                  <View style={styles.cardContent}>
                    <Text style={styles.name}>{dish.name}</Text>
                    <Text style={styles.description} numberOfLines={2}>
                      {dish.description}
                    </Text>
                    <Text style={styles.meta}>{dish.price.toFixed(2)} €</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background, paddingHorizontal: 24, gap: 8 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    gap: 8,
  },
  input: { flex: 1, fontSize: 15 },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#000', marginBottom: 8, marginTop: 4 },
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 10,
    marginBottom: 12,
    gap: 12,
  },
  image: { width: 70, height: 70, borderRadius: 12 },
  cardContent: { flex: 1, justifyContent: 'center' },
  name: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  description: { fontSize: 13, color: '#666', marginBottom: 4 },
  meta: { fontSize: 12, color: Colors.muted },
  emptyText: { textAlign: 'center', color: Colors.muted },
});

export default Search;
