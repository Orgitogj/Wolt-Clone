import { Colors } from '@/constants/theme';
import { useCartStore } from '@/hooks/use-cartstore';
import { useDish } from '@/hooks/useMenu';
import { useRestaurant } from '@/hooks/useRestaurants';
import type { SelectedAddon } from '@/types/database';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DIETARY_BADGES: Record<string, string> = {
  vegan: '🌱 VEGAN',
  vegetarian: '🥦 VEGETARIAN',
};

const Page = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const cartStore = useCartStore();

  const { data: dish, isLoading } = useDish(id ?? '');
  const { data: restaurant } = useRestaurant(dish?.restaurant_id ?? '');
  const insets = useSafeAreaInsets();

  const [quantity, setQuantity] = useState(1);
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);

  const addonOptions = dish?.addons ?? [];

  const selectedAddonPrice = addonOptions.reduce((sum, option) => {
    return selectedAddonIds.includes(option.id) ? sum + option.price_delta : sum;
  }, 0);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.secondary} />
      </View>
    );
  }

  if (!dish) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Dish not found</Text>
      </View>
    );
  }

  const totalPrice = (dish.price + selectedAddonPrice) * quantity;

  const handleDecrement = () => {
    if (quantity > 1) {
      setQuantity(quantity - 1);
    }
  };

  const handleIncrement = () => {
    setQuantity(quantity + 1);
  };

  const toggleAddon = (addonId: string) => {
    setSelectedAddonIds((prev) =>
      prev.includes(addonId) ? prev.filter((id) => id !== addonId) : [...prev, addonId]
    );
  };

  const buildSelectedAddons = (): SelectedAddon[] =>
    addonOptions
      .filter((option) => selectedAddonIds.includes(option.id))
      .map((option) => ({ id: option.id, name: option.name, priceDelta: option.price_delta }));

  const addToCart = () => {
    cartStore.setSelectedRestaurant(restaurant ?? cartStore.selectedRestaurant);
    cartStore.addItem(dish, quantity, buildSelectedAddons());
    router.dismiss();
  };

  const onAddToOrder = () => {
    if (!cartStore.canAddFromRestaurant(dish.restaurant_id)) {
      Alert.alert(
        'Start a new order?',
        'Your cart has items from another restaurant. Adding this will clear your current cart.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Clear cart',
            style: 'destructive',
            onPress: () => {
              cartStore.clearCart();
              addToCart();
            },
          },
        ]
      );
      return;
    }
    addToCart();
  };

  return (
    <View style={styles.page}>
      <View style={styles.container}>
        {/* Close Button */}
        <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color="#000" />
        </TouchableOpacity>

        {/* Scrollable Content */}
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}>
          {/* Dish Image */}
          <View style={styles.imageContainer}>
            <Image source={{ uri: dish.image_url ?? undefined }} style={styles.image} />
          </View>

          {/* Dish Info */}
          <View style={styles.infoSection}>
            <Text style={styles.dishName}>{dish.name}</Text>
            <View style={styles.priceRow}>
              <Text style={styles.price}>{dish.price.toFixed(2)} €</Text>
              {dish.is_popular && (
                <View style={styles.popularBadge}>
                  <Text style={styles.popularText}>★ POPULAR</Text>
                </View>
              )}
              {dish.dietary_tags.map(
                (tag) =>
                  DIETARY_BADGES[tag] && (
                    <View key={tag} style={styles.veganBadge}>
                      <Text style={styles.veganText}>{DIETARY_BADGES[tag]}</Text>
                    </View>
                  )
              )}
            </View>
            <Text style={styles.description}>{dish.description}</Text>
          </View>

          {/* Addon Options */}
          {addonOptions.length > 0 && (
            <View style={styles.optionsSection}>
              <View style={styles.optionHeader}>
                <Text style={styles.optionTitle}>Your ingredients</Text>
              </View>
              {addonOptions.map((option) => {
                const isSelected = selectedAddonIds.includes(option.id);

                return (
                  <TouchableOpacity
                    key={option.id}
                    style={styles.checkboxOption}
                    onPress={() => toggleAddon(option.id)}
                    activeOpacity={0.8}>
                    <View style={styles.checkboxLeft}>
                      <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                        {isSelected && <Ionicons name="checkmark" size={16} color="#fff" />}
                      </View>
                      <Text style={styles.checkboxLabel}>{option.name}</Text>
                    </View>
                    <Text style={styles.optionPrice}>
                      {option.price_delta > 0 ? `+${option.price_delta.toFixed(2)} €` : 'Free'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>

      {/* Fixed Bottom Buttons */}
      <View style={[styles.bottomBar, { paddingBottom: 24 + insets.bottom }]}>
        {/* Quantity Controls */}
        <View style={styles.quantityControls}>
          <TouchableOpacity style={styles.quantityButton} onPress={handleDecrement}>
            <Text style={styles.quantityButtonText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.quantityText}>{quantity}</Text>
          <TouchableOpacity style={styles.quantityButton} onPress={handleIncrement}>
            <Text style={styles.quantityButtonText}>+</Text>
          </TouchableOpacity>
        </View>

        {/* Add to Order Button */}
        <TouchableOpacity style={styles.addButton} onPress={onAddToOrder}>
          <Text style={styles.addButtonText}>Add to order</Text>
          <Text style={styles.addButtonPrice}>{totalPrice.toFixed(2)} €</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
export default Page;

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 160,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  errorText: {
    fontSize: 16,
    color: '#ff4444',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.15)',
  },

  imageContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  image: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#e0e0e0',
  },
  infoSection: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  dishName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000',
    marginBottom: 12,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  price: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.secondary,
  },
  popularBadge: {
    backgroundColor: Colors.secondary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  popularText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  veganBadge: {
    backgroundColor: '#4caf50',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  veganText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  description: {
    fontSize: 15,
    color: '#333',
    lineHeight: 22,
  },
  optionsSection: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 8,
    borderTopColor: '#f5f5f5',
  },
  optionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  optionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
  },
  optionPrice: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  checkboxOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  checkboxLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  checkboxSelected: {
    backgroundColor: Colors.secondary,
  },
  checkboxLabel: {
    fontSize: 16,
    color: '#000',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    flexDirection: 'row',
    gap: 12,
    boxShadow: '0px -2px 10px rgba(0, 0, 0, 0.1)',
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingHorizontal: 4,
  },
  quantityButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityButtonText: {
    fontSize: 24,
    fontWeight: '600',
    color: Colors.secondary,
  },
  quantityText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    minWidth: 30,
    textAlign: 'center',
  },
  addButton: {
    flex: 1,
    backgroundColor: Colors.secondary,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  addButtonPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
