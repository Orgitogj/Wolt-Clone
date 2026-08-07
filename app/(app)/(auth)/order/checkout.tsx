import { PurchaseButton } from '@/components/buttons/PurchaseButton';
import { Colors } from '@/constants/theme';
import useAuthStore from '@/hooks/use-auth-store';
import { useAddressSelectionStore } from '@/hooks/use-address-store';
import { useCartStore } from '@/hooks/use-cartstore';
import { useScheduleStore } from '@/hooks/use-schedule-store';
import { useAddresses } from '@/hooks/useAddresses';
import { useInvalidateOrderHistory } from '@/hooks/useOrderHistory';
import { orderService } from '@/services/orderService';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

const MAP_HEIGHT = 250;
const TIP_PRESETS = [0, 1, 2, 5];

const Page = () => {
  const router = useRouter();
  const { user } = useAuthStore();
  const { items, total, selectedRestaurant, clearCart } = useCartStore();
  const invalidateOrderHistory = useInvalidateOrderHistory();
  const { addresses, addAddress } = useAddresses();
  const { selectedAddressId, selectAddress } = useAddressSelectionStore();
  const { selectedSchedule } = useScheduleStore();
  const scrollOffset = useSharedValue(0);

  // State
  const [deliveryMode, setDeliveryMode] = useState<'delivery' | 'pickup'>('delivery');
  const [leaveAtDoor, setLeaveAtDoor] = useState(false);
  const [sendAsGift, setSendAsGift] = useState(false);
  const [deliveryTime, setDeliveryTime] = useState<'standard' | 'schedule' | null>(null);
  const [tipAmount, setTipAmount] = useState(0);
  const [showCustomTip, setShowCustomTip] = useState(false);
  const [customTipText, setCustomTipText] = useState('');
  const [showAddressOptions, setShowAddressOptions] = useState(false);
  const [addressLabel, setAddressLabel] = useState('');
  const [addressDetail, setAddressDetail] = useState('');
  const [showNewAddressForm, setShowNewAddressForm] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedAddress = addresses.find((option) => option.id === selectedAddressId);

  const scheduleLabel = selectedSchedule
    ? `${selectedSchedule.day} • ${selectedSchedule.time}`
    : 'Choose a delivery time';

  // Calculate fees using real distance when both coordinates are known
  const distanceKm =
    deliveryMode === 'delivery' &&
    selectedAddress?.latitude != null &&
    selectedAddress?.longitude != null &&
    selectedRestaurant?.latitude != null &&
    selectedRestaurant?.longitude != null
      ? orderService.calculateDistanceKm(
          selectedAddress.latitude,
          selectedAddress.longitude,
          selectedRestaurant.latitude,
          selectedRestaurant.longitude
        )
      : undefined;

  const { serviceFee, deliveryFee } = orderService.calculateFees(total, distanceKm);
  const grandTotal = total + serviceFee + deliveryFee + tipAmount;

  const canCheckout = deliveryTime !== null && (deliveryMode === 'pickup' || !!selectedAddress);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollOffset.value = event.contentOffset.y;
    },
  });

  const mapStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      scrollOffset.value,
      [-100, 0, 200],
      [1.3, 1, 0.9],
      Extrapolation.CLAMP
    );
    const translateY = interpolate(scrollOffset.value, [0, 200], [0, -50], Extrapolation.CLAMP);

    return {
      transform: [{ scale }, { translateY }],
    };
  });

  const handleUseCurrentLocation = async () => {
    setIsLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location permission needed', 'Enable location access to use this feature.');
        return;
      }
      const position = await Location.getCurrentPositionAsync();
      const [place] = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      const addressLineText =
        [place?.street, place?.streetNumber].filter(Boolean).join(' ') || 'Current location';

      const created = await addAddress({
        label: 'Current location',
        address_line: addressLineText,
        city: place?.city ?? null,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      selectAddress(created.id);
      setShowAddressOptions(false);
    } catch (error) {
      Alert.alert('Could not get location', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsLocating(false);
    }
  };

  const handleSaveAddress = async () => {
    if (!addressLabel.trim() || !addressDetail.trim()) {
      Alert.alert('Missing details', 'Please enter both a label and an address.');
      return;
    }

    const created = await addAddress({ label: addressLabel.trim(), address_line: addressDetail.trim() });
    selectAddress(created.id);
    setAddressLabel('');
    setAddressDetail('');
    setShowNewAddressForm(false);
    setShowAddressOptions(false);
  };

  const applyCustomTip = () => {
    const value = Number(customTipText.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) {
      Alert.alert('Invalid amount', 'Please enter a valid tip amount.');
      return;
    }
    setTipAmount(Number(value.toFixed(2)));
    setShowCustomTip(false);
  };

  const showHowFeesWork = () => {
    Alert.alert(
      'How fees work',
      `Service fee (${serviceFee.toFixed(2)} €) helps us run the app. Delivery fee (${deliveryFee.toFixed(2)} €) is based on the distance between the restaurant and your address.`
    );
  };

  const handleCheckout = async () => {
    if (!deliveryTime || !selectedRestaurant || !user) return;

    setIsSubmitting(true);
    try {
      const result = await orderService.createOrder({
        userId: user.id,
        restaurantId: selectedRestaurant.id,
        items,
        deliveryMode,
        addressId: deliveryMode === 'delivery' ? selectedAddress?.id ?? null : null,
        scheduledFor:
          deliveryTime === 'schedule' && selectedSchedule ? new Date().toISOString() : null,
        tipAmount,
        paymentMethod: 'applepay',
        leaveAtDoor,
        sendAsGift,
        subtotal: total,
        serviceFee,
        deliveryFee,
        total: grandTotal,
      });

      invalidateOrderHistory();
      clearCart();
      router.dismissTo('/restaurants');
      Alert.alert('Order placed!', `Your order #${result.orderId.slice(0, 8)} has been confirmed.`);
    } catch (error) {
      Alert.alert('Order failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: selectedRestaurant?.name }} />
      <Animated.View style={[styles.mapContainer, mapStyle]}>
        <View style={styles.mapPlaceholder}>
          <View style={styles.mapPin}>
            <Ionicons name="location" size={24} color={Colors.secondary} />
          </View>
          <Text style={styles.mapPlaceholderText}>{selectedRestaurant?.name ?? 'Selected restaurant'}</Text>
          <Text style={styles.mapPlaceholderAddress}>
            {selectedRestaurant?.address ?? 'Choose a restaurant to see its address'}
          </Text>
        </View>
      </Animated.View>

      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.scrollContent, { paddingTop: MAP_HEIGHT }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.contentContainer}>
          <View style={styles.section}>
            <View style={styles.pickerContainer}>
              <TouchableOpacity
                style={[styles.pickerOption, deliveryMode === 'delivery' && styles.pickerOptionActive]}
                onPress={() => setDeliveryMode('delivery')}>
                <Text
                  style={[
                    styles.pickerOptionText,
                    deliveryMode === 'delivery' && styles.pickerOptionTextActive,
                  ]}>
                  Delivery
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pickerOption, deliveryMode === 'pickup' && styles.pickerOptionActive]}
                onPress={() => setDeliveryMode('pickup')}>
                <Text
                  style={[
                    styles.pickerOptionText,
                    deliveryMode === 'pickup' && styles.pickerOptionTextActive,
                  ]}>
                  Pickup
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Delivery Address */}
          {deliveryMode === 'delivery' && (
            <TouchableOpacity
              style={styles.section}
              onPress={() => setShowAddressOptions((value) => !value)}
              activeOpacity={0.8}>
              <View style={styles.row}>
                <View style={styles.rowLeft}>
                  <View style={styles.addressIcon}>
                    <Ionicons name="location-outline" size={18} color={Colors.secondary} />
                  </View>
                  <View style={styles.addressTextContainer}>
                    <Text style={styles.sectionTitle}>Choose a delivery address</Text>
                    <Text style={styles.sectionSubtitle}>
                      {selectedAddress?.address_line ?? 'No address selected yet'}
                    </Text>
                  </View>
                </View>
                <Ionicons
                  name={showAddressOptions ? 'chevron-up' : 'chevron-forward'}
                  size={20}
                  color="#999"
                />
              </View>

              {showAddressOptions && (
                <View style={styles.addressOptions}>
                  <TouchableOpacity
                    style={styles.addressOption}
                    onPress={handleUseCurrentLocation}
                    disabled={isLocating}>
                    <View style={styles.addressOptionTextContainer}>
                      <Text style={styles.addressOptionLabel}>
                        {isLocating ? 'Locating…' : 'Use current location'}
                      </Text>
                    </View>
                    <Ionicons name="locate-outline" size={18} color={Colors.secondary} />
                  </TouchableOpacity>
                  {addresses.map((option) => {
                    const isSelected = option.id === selectedAddressId;

                    return (
                      <TouchableOpacity
                        key={option.id}
                        style={[styles.addressOption, isSelected && styles.addressOptionActive]}
                        onPress={() => {
                          selectAddress(option.id);
                          setShowAddressOptions(false);
                        }}>
                        <View style={styles.addressOptionTextContainer}>
                          <Text style={[styles.addressOptionLabel, isSelected && styles.addressOptionLabelActive]}>
                            {option.label}
                          </Text>
                          <Text style={styles.addressOptionDetail}>{option.address_line}</Text>
                        </View>
                        {isSelected && <Ionicons name="checkmark-circle" size={20} color={Colors.secondary} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {showAddressOptions && (
                <View style={styles.addressActions}>
                  <TouchableOpacity
                    style={styles.secondaryAction}
                    onPress={() => setShowNewAddressForm((value) => !value)}>
                    <Ionicons name="add-circle-outline" size={16} color={Colors.secondary} />
                    <Text style={styles.secondaryActionText}>Add new address</Text>
                  </TouchableOpacity>
                  {showNewAddressForm && (
                    <View style={styles.addressForm}>
                      <TextInput
                        style={styles.input}
                        placeholder="Label (Home, Work...)"
                        value={addressLabel}
                        onChangeText={setAddressLabel}
                      />
                      <TextInput
                        style={styles.input}
                        placeholder="Address details"
                        value={addressDetail}
                        onChangeText={setAddressDetail}
                      />
                      <TouchableOpacity style={styles.saveAddressButton} onPress={handleSaveAddress}>
                        <Text style={styles.saveAddressButtonText}>Save address</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            </TouchableOpacity>
          )}

          {/* Additional Options */}
          {deliveryMode === 'delivery' && (
            <View style={styles.section}>
              <View style={styles.row}>
                <Text style={styles.optionText}>Leave order at the door</Text>
                <Switch value={leaveAtDoor} onValueChange={setLeaveAtDoor} />
              </View>
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.row}>
              <Text style={styles.optionText}>Send as a gift</Text>
              <Switch value={sendAsGift} onValueChange={setSendAsGift} />
            </View>
          </View>

          {/* When? Section */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>When?</Text>

            {selectedSchedule && deliveryTime === 'schedule' && (
              <View style={styles.scheduleSummary}>
                <Ionicons name="time-outline" size={16} color={Colors.secondary} />
                <Text style={styles.scheduleSummaryText}>{scheduleLabel}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.radioRow, deliveryTime === 'standard' && styles.radioRowActive]}
              onPress={() => setDeliveryTime('standard')}>
              <View style={styles.radioLeft}>
                <View style={styles.radioCircle}>
                  {deliveryTime === 'standard' && <View style={styles.radioSelected} />}
                </View>
                <View>
                  <Text style={styles.radioLabel}>Standard</Text>
                  <Text style={styles.radioSubtext}>As soon as possible</Text>
                </View>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.radioRow, deliveryTime === 'schedule' && styles.radioRowActive]}
              onPress={() => {
                setDeliveryTime('schedule');
                router.push('/order/schedule');
              }}>
              <View style={styles.radioLeft}>
                <View style={styles.radioCircle}>
                  {deliveryTime === 'schedule' && <View style={styles.radioSelected} />}
                </View>
                <View>
                  <Text style={styles.radioLabel}>Schedule</Text>
                  <Text style={styles.radioSubtext}>Choose a delivery time</Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>

          {/* Payment Section */}
          <View style={styles.section}>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <View style={styles.paymentIcon}>
                  <Ionicons name="logo-apple" size={24} color="#000" />
                </View>
                <Text style={styles.optionText}>Apple Pay</Text>
              </View>
              <Text style={styles.paymentAmount}>{grandTotal.toFixed(2)} €</Text>
            </View>
          </View>

          {/* Add Courier Tip */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Add courier tip</Text>
            <Text style={styles.tipDescription}>
              100% of your tip goes to your courier. Its an easy way to say thanks for great
              service.
            </Text>

            <View style={styles.tipButtons}>
              {TIP_PRESETS.map((amount) => (
                <TouchableOpacity
                  key={amount}
                  style={[styles.tipButton, tipAmount === amount && !showCustomTip && styles.tipButtonActive]}
                  onPress={() => {
                    setTipAmount(amount);
                    setShowCustomTip(false);
                  }}>
                  <Text
                    style={[
                      styles.tipButtonText,
                      tipAmount === amount && !showCustomTip && styles.tipButtonTextActive,
                    ]}>
                    {amount === 0 ? 'No tip' : `${amount} €`}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.tipButton, showCustomTip && styles.tipButtonActive]}
                onPress={() => setShowCustomTip((v) => !v)}>
                <Text style={[styles.tipButtonText, showCustomTip && styles.tipButtonTextActive]}>Custom</Text>
              </TouchableOpacity>
            </View>

            {showCustomTip && (
              <View style={styles.customTipRow}>
                <TextInput
                  style={styles.customTipInput}
                  placeholder="Amount in €"
                  keyboardType="decimal-pad"
                  value={customTipText}
                  onChangeText={setCustomTipText}
                />
                <TouchableOpacity style={styles.saveAddressButton} onPress={applyCustomTip}>
                  <Text style={styles.saveAddressButtonText}>Set tip</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Summary */}
          <View style={styles.section}>
            <TouchableOpacity style={styles.summaryHeader} onPress={showHowFeesWork}>
              <Text style={styles.summaryHeaderText}>How fees work</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.secondary} />
            </TouchableOpacity>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Item subtotal</Text>
              <Text style={styles.summaryValue}>{total.toFixed(2)} €</Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Service fee</Text>
              <Text style={styles.summaryValue}>{serviceFee.toFixed(2)} €</Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Delivery fee</Text>
              <Text style={styles.summaryValue}>{deliveryFee.toFixed(2)} €</Text>
            </View>

            {tipAmount > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Courier tip</Text>
                <Text style={styles.summaryValue}>{tipAmount.toFixed(2)} €</Text>
              </View>
            )}

            <View style={[styles.summaryRow, styles.summaryTotal]}>
              <Text style={styles.summaryTotalText}>Total</Text>
              <Text style={styles.summaryTotalValue}>{grandTotal.toFixed(2)} €</Text>
            </View>
          </View>

          {/* Bottom spacing for button */}
          <View style={{ height: 100 }} />
        </View>
      </Animated.ScrollView>

      <PurchaseButton
        onPress={handleCheckout}
        deliveryTimeSelected={deliveryTime !== null}
        disabled={!canCheckout || isSubmitting}
      />
    </View>
  );
};
export default Page;
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },

  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.15)',
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    textAlign: 'center',
    marginHorizontal: 12,
  },
  infoButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.15)',
  },
  mapContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: MAP_HEIGHT,
    zIndex: 0,
  },
  mapPlaceholder: {
    flex: 1,
    backgroundColor: '#e8e8e8',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  mapPin: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  mapPlaceholderText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#222',
    textAlign: 'center',
  },
  mapPlaceholderAddress: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  scrollContent: {
    paddingBottom: 16,
  },
  contentContainer: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: -20,
    paddingTop: 8,
  },
  section: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  addressIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f1f8fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressTextContainer: {
    flex: 1,
  },
  addressOptions: {
    marginTop: 12,
    gap: 8,
  },
  addressActions: {
    marginTop: 12,
    gap: 8,
  },
  secondaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  secondaryActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.secondary,
  },
  addressForm: {
    gap: 8,
    paddingTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e6e6e6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#000',
  },
  saveAddressButton: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.secondary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  saveAddressButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  addressOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f7f7f7',
    borderWidth: 1,
    borderColor: '#ececec',
  },
  addressOptionActive: {
    borderColor: Colors.secondary,
    backgroundColor: '#f1f8fe',
  },
  addressOptionTextContainer: {
    flex: 1,
  },
  addressOptionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginBottom: 2,
  },
  addressOptionLabelActive: {
    color: Colors.secondary,
  },
  addressOptionDetail: {
    fontSize: 13,
    color: '#666',
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#999',
  },
  optionText: {
    fontSize: 16,
    color: '#000',
  },
  pickerContainer: {
    flexDirection: 'row',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 4,
  },
  pickerOption: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
  },
  pickerOptionActive: {
    backgroundColor: '#fff',
    boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.08)',
  },
  pickerOptionText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#666',
  },
  pickerOptionTextActive: {
    color: '#000',
    fontWeight: '600',
  },
  sectionHeader: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    marginBottom: 16,
  },
  scheduleSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#f1f8fe',
    borderRadius: 10,
  },
  scheduleSummaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.secondary,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  radioRowActive: {
    opacity: 1,
  },
  radioLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  radioCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.secondary,
  },
  radioLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  radioSubtext: {
    fontSize: 14,
    color: '#666',
  },
  paymentIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  tipDescription: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 16,
  },
  tipButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tipButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
    backgroundColor: '#fff',
  },
  tipButtonActive: {
    borderColor: Colors.secondary,
    backgroundColor: '#f0f9ff',
  },
  tipButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  tipButtonTextActive: {
    color: Colors.secondary,
  },
  customTipRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    alignItems: 'center',
  },
  customTipInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e6e6e6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#000',
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 16,
  },
  summaryHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.secondary,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 15,
    color: '#666',
  },
  summaryValue: {
    fontSize: 15,
    color: '#000',
  },
  summaryTotal: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e8e8e8',
    marginTop: 4,
  },
  summaryTotalText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  summaryTotalValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
});
