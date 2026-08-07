import { MenuItem } from '@/components/MenuItem';
import RestaurantDetailsHeader from '@/components/RestaurantDetailsHeader';
import ViewOrderButton from '@/components/buttons/ViewOrderButton';
import { Colors } from '@/constants/theme';
import type { Dish, Restaurant } from '@/types/database';
import { useMenu } from '@/hooks/useMenu';
import { useRestaurant } from '@/hooks/useRestaurants';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  ScrollView,
  SectionList,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

const { width } = Dimensions.get('window');
const IMAGE_HEIGHT = 300;
const STICKY_THRESHOLD_START = 260;
const STICKY_THRESHOLD_END = 320;

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

function getOpenStatusText(restaurant: Restaurant): string {
  if (!restaurant.is_open) return 'Closed';
  const hours = restaurant.opening_hours;
  if (!hours) return 'Open';
  const today = DAY_NAMES[new Date().getDay()];
  const range = hours[today];
  if (!range || range.toLowerCase() === 'closed') return 'Closed today';
  const [, close] = range.split('-');
  return close ? `Open until ${close}` : 'Open';
}

function showMoreInfo(restaurant: Restaurant) {
  const hours = restaurant.opening_hours;
  const hoursText = hours
    ? Object.entries(hours)
        .map(([day, range]) => `${day.slice(0, 3)}: ${range}`)
        .join('\n')
    : 'Opening hours unavailable';
  Alert.alert(restaurant.name, `${restaurant.address ?? ''}\n\n${hoursText}`);
}

function shareVenue(restaurant: Restaurant) {
  Share.share({ message: `Check out ${restaurant.name} on Wolt!` });
}

const AnimatedSectionList = Animated.createAnimatedComponent(SectionList<Dish>);

const Page = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [activeCategory, setActiveCategory] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const sectionListRef = useRef<SectionList>(null);
  const categoryScrollRef = useRef<ScrollView>(null);
  const scrollOffset = useSharedValue(0);
  const insets = useSafeAreaInsets();
  const categoryTabWidth = 100;

  const { data: restaurant, isLoading: restaurantLoading } = useRestaurant(id || '');
  const { data: menu, isLoading: menuLoading } = useMenu(id || '');

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const sections = useMemo(
    () =>
      menu?.map((category) => ({
        title: category.name,
        subtitle: category.subtitle,
        data: category.dishes,
      })) || [],
    [menu]
  );

  const filteredSections = useMemo(() => {
    if (!normalizedQuery) {
      return sections;
    }

    return sections.flatMap((section) => {
      const filteredDishes = section.data.filter((dish) => {
        const haystack = `${dish.name} ${dish.description}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      });

      return filteredDishes.length > 0
        ? [{ ...section, data: filteredDishes }]
        : [];
    });
  }, [normalizedQuery, sections]);

  const visibleCategories = useMemo(() => {
    if (!normalizedQuery) {
      return (menu ?? []).map((category, index) => ({
        label: category.name,
        sectionIndex: index,
      }));
    }

    return filteredSections.map((section, index) => ({
      label: section.title,
      sectionIndex: index,
    }));
  }, [filteredSections, menu, normalizedQuery]);

  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  useEffect(() => {
    setActiveCategory(0);
  }, [normalizedQuery]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollOffset.value = event.contentOffset.y;
    },
  });

  const parallaxStyle = useAnimatedStyle(() => {
    const scale = interpolate(scrollOffset.value, [-100, 0], [1.5, 1], Extrapolation.CLAMP);
    const translateY = interpolate(scrollOffset.value, [0, 400], [0, -150], Extrapolation.CLAMP);
    return {
      transform: [{ scale }, { translateY }],
    };
  });

  const overlayStyle = useAnimatedStyle(() => {
    const opacity = interpolate(scrollOffset.value, [0, 70], [0, 1], Extrapolation.CLAMP);
    return { opacity };
  });

  const scrollCategoryTabIntoView = (index: number) => {
    categoryScrollRef?.current?.scrollTo({
      x: index * categoryTabWidth - width / 2 + categoryTabWidth / 2,
      animated: true,
    });
  };

  const handleCategoryPress = (sectionIndex: number) => {
    setActiveCategory(sectionIndex);
    sectionListRef.current?.scrollToLocation({
      sectionIndex,
      itemIndex: 0,
      animated: true,
      viewOffset: insets.top + 100,
    });
    scrollCategoryTabIntoView(sectionIndex);
  };

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: any[] }) => {
      if (viewableItems.length === 0) return;

      const firstVisibleSection = viewableItems[0].section;
      const sectionIndex = sectionsRef.current.findIndex(
        (s) => s.title === firstVisibleSection.title
      );

      if (sectionIndex === -1) return;

      setActiveCategory((prev) => {
        if (sectionIndex !== prev) {
          scrollCategoryTabIntoView(sectionIndex);
          return sectionIndex;
        }
        return prev;
      });
    }
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 10,
    minimumViewTime: 100,
  }).current;

  const stickyTabsStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollOffset.value,
      [STICKY_THRESHOLD_START, STICKY_THRESHOLD_END],
      [0, 1],
      Extrapolation.CLAMP
    );
    return { opacity };
  });

  if (restaurantLoading || menuLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size={'large'} color={Colors.secondary} />
      </View>
    );
  }

  if (!restaurant) {
    return (
      <View style={styles.centered}>
        <Text>Restaurant not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Animated.Image
        style={[styles.backgroundImage, parallaxStyle]}
        resizeMode={'cover'}
        source={{ uri: restaurant.image_url ?? undefined }}
      />
      <Animated.View style={[styles.whiteOverlay, overlayStyle]} />
      <View style={{ zIndex: 10 }}>
        <RestaurantDetailsHeader
          scrollOffset={scrollOffset}
          restaurant={restaurant}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      </View>
      <Animated.View style={[styles.stickyTabsOverlay, stickyTabsStyle, { top: insets.top + 64 }]}>
        <View style={styles.categoryTabsContainer}>
          <ScrollView
            horizontal
            ref={categoryScrollRef}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryTabs}>
            {visibleCategories.map((category, index) => (
              <TouchableOpacity
                key={`sticky-${index}`}
                onPress={() => handleCategoryPress(category.sectionIndex)}
                style={[styles.categoryTab, activeCategory === category.sectionIndex && styles.categoryTabActive]}>
                <Text
                  style={[
                    styles.categoryTabText,
                    activeCategory === category.sectionIndex && styles.categoryTabTextActive,
                  ]}>
                  {category.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Animated.View>
      <AnimatedSectionList
        ref={sectionListRef}
        sections={filteredSections}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        ListEmptyComponent={
          <View style={styles.emptyStateContainer}>
            <Text style={styles.emptyStateTitle}>No dishes match your search</Text>
            <Text style={styles.emptyStateText}>Try another dish or ingredient.</Text>
          </View>
        }
        renderSectionHeader={({ section }: { section: any }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.subtitle && <Text style={styles.sectionSubtitle}>{section.subtitle}</Text>}
          </View>
        )}
        renderItem={({ item }) => <MenuItem dish={item} />}
        ListHeaderComponent={
          <>
            <View style={styles.imageSpacer} />

            <View style={styles.whiteContentContainer}>
              <Svg
                height={30}
                width={width}
                viewBox={`0 0 ${width} 30`}
                style={{ position: 'absolute', top: -29, left: 0 }}>
                <Path d={`M 0,30 Q ${width / 2},0 ${width},30 L ${width},30 L 0,30 Z`} fill="#fff" />
              </Svg>

              <View style={styles.logoContainer}>
                <Image source={{ uri: restaurant.image_url ?? undefined }} style={styles.logo} />
              </View>

              {/* Restaurant Info */}
              <View style={styles.restaurantInfo}>
                <Text style={styles.restaurantName}>{restaurant.name}</Text>
                <View style={styles.infoRow}>
                  <Ionicons name="star-outline" size={16} color="#666" />
                  <Text style={styles.infoText}>{restaurant.rating}</Text>
                  <Text style={styles.infoDot}>•</Text>
                  <Text style={styles.infoText}>{getOpenStatusText(restaurant)}</Text>
                  <Text style={styles.infoDot}>•</Text>
                  <Text style={styles.infoText}>Min. order {restaurant.min_order.toFixed(2)} €</Text>
                </View>
                <View style={styles.infoRow}>
                  <Ionicons name="bicycle-outline" size={16} color="#666" />
                  <Text style={styles.infoText}>{restaurant.delivery_fee.toFixed(2)} €</Text>
                  <Text style={styles.infoDot}>•</Text>
                  <TouchableOpacity onPress={() => showMoreInfo(restaurant)}>
                    <Text style={styles.moreLink}>More</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Delivery Info */}
              <View style={styles.deliveryInfo}>
                <View style={styles.deliveryButton}>
                  <Ionicons name="bicycle" size={16} color="#009de0" />
                  <Text style={styles.deliveryText}>
                    Delivery {restaurant.delivery_time_min}-{restaurant.delivery_time_max} min
                  </Text>
                </View>
                <TouchableOpacity style={styles.iconButtonSmall} onPress={() => shareVenue(restaurant)}>
                  <Ionicons name="share-social-outline" size={20} color="#009de0" />
                </TouchableOpacity>
              </View>
            </View>
          </>
        }
      />

      <ViewOrderButton restaurant={restaurant} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  emptyStateContainer: {
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 24,
    alignItems: 'center',
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  emptyStateText: {
    fontSize: 14,
    color: Colors.muted,
    marginTop: 8,
    textAlign: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backgroundImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    width,
    height: IMAGE_HEIGHT,
  },
  whiteOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    width,
    height: IMAGE_HEIGHT,
    backgroundColor: Colors.background,
  },
  sectionHeader: {
    padding: 16,
    backgroundColor: Colors.background,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: Colors.muted,
  },
  imageSpacer: {
    height: IMAGE_HEIGHT - 60,
  },
  whiteContentContainer: {
    backgroundColor: '#fff',
    marginTop: -30,
    paddingTop: 30,
    overflow: 'visible',
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: -60,
    marginBottom: 16,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 16,
    backgroundColor: Colors.background,
    borderWidth: 3,
    borderColor: Colors.background,
    boxShadow: '0px 4px 10px 2px rgba(0, 0, 0, 0.3)',
  },
  restaurantInfo: {
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  restaurantName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000',
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
  },
  infoDot: {
    fontSize: 14,
    color: '#999',
  },
  moreLink: {
    fontSize: 14,
    color: Colors.secondary,
    fontWeight: '600',
  },
  deliveryInfo: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
  },
  deliveryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f9ff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 6,
  },
  deliveryText: {
    fontSize: 14,
    color: Colors.secondary,
    fontWeight: '600',
  },
  iconButtonSmall: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#f0f9ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickyTabsOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: '#fff',
  },
  categoryTabsContainer: {
    boxShadow: '0px 4px 2px -2px rgba(0, 0, 0, 0.1)',
  },
  categoryTabs: {
    paddingTop: 12,
    paddingHorizontal: 16,
    gap: 20,
  },
  categoryTab: {
    paddingBottom: 12,
  },
  categoryTabActive: {
    borderBottomWidth: 3,
    borderBottomColor: Colors.secondary,
  },
  categoryTabText: {
    fontSize: 15,
    color: Colors.muted,
    fontWeight: '500',
  },
  categoryTabTextActive: {
    color: Colors.secondary,
    fontWeight: '600',
  },
});

export default Page;