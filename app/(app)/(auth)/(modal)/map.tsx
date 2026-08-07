import { Colors } from '@/constants/theme';
import { useFilterStore } from '@/hooks/use-filters-store';
import { useRestaurantMarkers, useRestaurants } from '@/hooks/useRestaurants';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { Link, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DEFAULT_REGION = {
  latitude: 51.9625,
  longitude: 7.6257,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

const Page = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  const { data: restaurants, isLoading: restaurantsLoading } = useRestaurants();
  const { data: restaurantMarkers, isLoading: markersLoading } = useRestaurantMarkers();
  const { selectedCuisines, selectedPrice, woltPlusOnly, selectedSort } = useFilterStore();

  const locateMe = async () => {
    try {
      const location = await Location.getCurrentPositionAsync();
      mapRef.current?.animateToRegion({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    } catch (error) {
      console.error('Failed to get location:', error);
    }
  };

  useEffect(() => {
    async function getCurrentLocation() {
      let { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        console.log('Permission was not granted');
        return;
      }
      locateMe();
    }
    getCurrentLocation();
  }, []);

  const filteredRestaurants = (restaurants ?? []).filter((restaurant) => {
    const matchesCuisine =
      selectedCuisines.length === 0 ||
      selectedCuisines.some((cuisine) => restaurant.cuisines.includes(cuisine));

    const matchesPrice =
      !selectedPrice ||
      (selectedPrice === '€' && restaurant.delivery_fee <= 1.5) ||
      (selectedPrice === '€€' && restaurant.delivery_fee > 1.5 && restaurant.delivery_fee <= 2.5) ||
      (selectedPrice === '€€€' && restaurant.delivery_fee > 2.5 && restaurant.delivery_fee <= 3.5) ||
      (selectedPrice === '€€€€' && restaurant.delivery_fee > 3.5);

    const matchesWoltPlus = !woltPlusOnly || restaurant.tags.some((tag) => tag.includes('Wolt+'));

    return matchesCuisine && matchesPrice && matchesWoltPlus;
  });

  const sortedRestaurants = [...filteredRestaurants].sort((a, b) => {
    switch (selectedSort) {
      case 'Delivery price':
        return a.delivery_fee - b.delivery_fee;
      case 'Rating':
        return b.rating - a.rating;
      case 'Delivery time':
        return a.delivery_time_min - b.delivery_time_min;
      default:
        return 0;
    }
  });

  if (restaurantsLoading || markersLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size={'large'} color={Colors.secondary} />
      </View>
    );
  }

  const markerSelected = (id: string) => {
    router.push(`/(modal)/(restaurant)/${id}`);
  };

  return (
    <>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.dismiss()}>
          <Ionicons name="chevron-back" size={22} color={Colors.muted} />
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <Link href={'/(app)/(auth)/(modal)/filter'} asChild>
            <TouchableOpacity style={styles.backButton}>
              <Ionicons name="filter" size={22} />
            </TouchableOpacity>
          </Link>
          <TouchableOpacity style={styles.backButton} onPress={locateMe}>
            <Ionicons name="locate-outline" size={22} />
          </TouchableOpacity>
        </View>
      </View>

      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={
          restaurantMarkers?.[0]
            ? {
                latitude: restaurantMarkers[0].latitude ?? DEFAULT_REGION.latitude,
                longitude: restaurantMarkers[0].longitude ?? DEFAULT_REGION.longitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }
            : DEFAULT_REGION
        }
      >
        {restaurantMarkers
          ?.filter((marker) => marker.latitude != null && marker.longitude != null)
          .map((marker) => (
            <Marker
              key={marker.id}
              coordinate={{
                latitude: marker.latitude!,
                longitude: marker.longitude!,
              }}
              title={marker.name}
              pinColor={Colors.muted}
              onPress={() => markerSelected(marker.id)}
            />
          ))}
      </MapView>

      <View style={styles.footerScroll}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}>
          {sortedRestaurants.map((restaurant) => (
            <TouchableOpacity
              key={restaurant.id}
              style={styles.card}
              onPress={() => router.push(`/(modal)/(restaurant)/${restaurant.id}`)}>
              <Image source={{ uri: restaurant.image_url ?? undefined }} style={styles.cardImage} />
              <View style={styles.cardContent}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {restaurant.name}
                  </Text>
                  {restaurant.tags.includes('Wolt+') && (
                    <View style={styles.woltBadge}>
                      <Text style={styles.woltBadgeText}>W+</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.cardDescription} numberOfLines={1}>
                  {restaurant.description}
                </Text>
                <View style={styles.cardFooter}>
                  <Ionicons name="bicycle-outline" size={14} color="#666" />
                  <Text style={styles.cardFooterText}>
                    {restaurant.delivery_fee === 0
                      ? 'Free delivery'
                      : `${restaurant.delivery_fee.toFixed(2)} €`}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </>
  );
};
export default Page;

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 40,
    height: 40,
    backgroundColor: Colors.background,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 4px 2px -2px rgba(0, 0, 0, 0.1)',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerScroll: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    paddingBottom: 20,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 12,
    marginVertical: 16,
  },
  card: {
    width: 280,
    backgroundColor: '#fff',
    borderRadius: 16,
    boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.15)',
    flexDirection: 'row',
  },
  cardImage: {
    width: 60,
    height: 60,
    borderRadius: 12,
    margin: 10,
  },
  cardContent: {
    flex: 1,
    padding: 12,
    paddingLeft: 0,
    justifyContent: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000',
    flex: 1,
  },
  woltBadge: {
    backgroundColor: '#009de0',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  woltBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  cardDescription: {
    fontSize: 13,
    color: '#666',
    marginBottom: 6,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardFooterText: {
    fontSize: 12,
    color: '#666',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});