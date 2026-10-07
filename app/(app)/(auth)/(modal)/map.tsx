import { Colors } from '@/constants/theme';
import { useFilterStore } from '@/hooks/use-filters-store';
import { useRestaurantsInBounds } from '@/hooks/useRestaurants';
import type { MapBounds } from '@/services/restaurantService';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { Link, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DEFAULT_REGION = {
  latitude: 51.9625,
  longitude: 7.6257,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

const CARD_WIDTH = 240;

const regionToBounds = (region: Region) => ({
  minLat: region.latitude - region.latitudeDelta / 2,
  maxLat: region.latitude + region.latitudeDelta / 2,
  minLng: region.longitude - region.longitudeDelta / 2,
  maxLng: region.longitude + region.longitudeDelta / 2,
});

const Page = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const carouselRef = useRef<ScrollView>(null);

  const { selectedCuisines, selectedPrice, woltPlusOnly, selectedSort } = useFilterStore();
  const [bounds, setBounds] = useState<MapBounds | null>(regionToBounds(DEFAULT_REGION));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const {
    data: visibleRestaurants,
    isLoading: restaurantsLoading,
    isFetching: restaurantsFetching,
    error: restaurantsError,
    refetch: refetchRestaurants,
  } = useRestaurantsInBounds(bounds, {
    cuisines: selectedCuisines.length ? selectedCuisines : undefined,
    priceTier: selectedPrice,
    woltPlusOnly,
    sort: selectedSort,
  });

  const restaurants = visibleRestaurants ?? [];

  const onRegionChangeComplete = useCallback((region: Region) => {
    setBounds(regionToBounds(region));
  }, []);

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

  const markerSelected = (id: string) => {
    setSelectedId(id);
    const index = restaurants.findIndex((restaurant) => restaurant.id === id);
    if (index >= 0) {
      carouselRef.current?.scrollTo({ x: index * CARD_WIDTH, animated: true });
    }
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
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
        initialRegion={DEFAULT_REGION}
        onRegionChangeComplete={onRegionChangeComplete}>
        {restaurants
          .filter((restaurant) => restaurant.latitude != null && restaurant.longitude != null)
          .map((restaurant) => (
            <Marker
              key={restaurant.id}
              coordinate={{
                latitude: restaurant.latitude!,
                longitude: restaurant.longitude!,
              }}
              title={restaurant.name}
              pinColor={restaurant.id === selectedId ? Colors.primary : Colors.muted}
              onPress={() => markerSelected(restaurant.id)}
            />
          ))}
      </MapView>

      {restaurantsLoading && (
        <View style={styles.statusPill}>
          <ActivityIndicator size="small" color={Colors.secondary} />
          <Text style={styles.statusPillText}>Loading venues</Text>
        </View>
      )}

      {!restaurantsLoading && restaurantsFetching && (
        <View style={styles.statusPill}>
          <ActivityIndicator size="small" color={Colors.secondary} />
          <Text style={styles.statusPillText}>Updating this area</Text>
        </View>
      )}

      {!!restaurantsError && (
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>Could not load this area</Text>
          <TouchableOpacity onPress={() => refetchRestaurants()} accessibilityRole="button">
            <Text style={styles.statusPillAction}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {!restaurantsLoading && !restaurantsError && restaurants.length === 0 && (
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>No venues in this area</Text>
        </View>
      )}

      <View style={styles.footerScroll}>
        <ScrollView
          ref={carouselRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}>
          {restaurants.map((restaurant) => (
            <TouchableOpacity
              key={restaurant.id}
              style={[styles.card, restaurant.id === selectedId && styles.cardSelected]}
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
  statusPill: {
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    boxShadow: '0px 4px 2px -2px rgba(0, 0, 0, 0.1)',
  },
  statusPillText: {
    fontSize: 13,
    color: Colors.muted,
  },
  statusPillAction: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.secondary,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: Colors.primary,
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
});
