import useAuthStore from '@/hooks/use-auth-store';
import { useAddressSelectionStore } from '@/hooks/use-address-store';
import { useCartContents, useCartStore } from '@/hooks/use-cartstore';
import { useScheduleStore } from '@/hooks/use-schedule-store';
import { useAddresses } from '@/hooks/useAddresses';
import { useInvalidateOrderHistory } from '@/hooks/useOrderHistory';
import { usePayForOrder } from '@/hooks/usePayment';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { usePromoCode, type AppliedPromotion } from '@/hooks/usePromotions';
import { orderService } from '@/services/orderService';
import { PROMOTION_MESSAGES } from '@/services/promotionService';
import type { Address, Restaurant } from '@/types/database';
import { createIdempotencyKey } from '@/utils/idempotency';
import { currentSessionEpoch, isStaleSession } from '@/utils/sessionGuard';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

export const TIP_PRESETS = [0, 1, 2, 5];

export type DeliveryMode = 'delivery' | 'pickup';
export type DeliveryTimeChoice = 'standard' | 'schedule';
export type PaymentMethod = 'card' | 'cash';

export interface CheckoutDelivery {
  mode: DeliveryMode;
  setMode: (mode: DeliveryMode) => void;
  leaveAtDoor: boolean;
  setLeaveAtDoor: (value: boolean) => void;
  sendAsGift: boolean;
  setSendAsGift: (value: boolean) => void;
}

export interface CheckoutAddress {
  addresses: Address[];
  selected: Address | undefined;
  selectedId: string | null;
  select: (id: string) => void;
  isOpen: boolean;
  toggle: () => void;
  isLocating: boolean;
  useCurrentLocation: () => Promise<void>;
  isFormOpen: boolean;
  toggleForm: () => void;
  label: string;
  setLabel: (value: string) => void;
  detail: string;
  setDetail: (value: string) => void;
  save: () => Promise<void>;
}

export interface CheckoutSchedule {
  choice: DeliveryTimeChoice | null;
  label: string;
  hasSelection: boolean;
  chooseStandard: () => void;
  chooseSchedule: () => void;
}

export interface CheckoutPayment {
  method: PaymentMethod;
  setMethod: (method: PaymentMethod) => void;
  cardEnabled: boolean;
}

export interface CheckoutTip {
  amount: number;
  presets: number[];
  isCustomOpen: boolean;
  toggleCustom: () => void;
  selectPreset: (amount: number) => void;
  customText: string;
  setCustomText: (value: string) => void;
  applyCustom: () => void;
}

export interface CheckoutPromo {
  input: string;
  setInput: (value: string) => void;
  applied: AppliedPromotion | null;
  error: string | null;
  isChecking: boolean;
  apply: () => Promise<void>;
  remove: () => void;
}

export interface CheckoutSummary {
  subtotal: number;
  serviceFee: number;
  deliveryFee: number;
  tipAmount: number;
  discount: number;
  grandTotal: number;
  currency: string;
  promoCode: string | null;
  explainFees: () => void;
}

export interface CheckoutSubmission {
  place: () => Promise<void>;
  canPlace: boolean;
  isBusy: boolean;
  deliveryTimeSelected: boolean;
  label: string;
}

export interface Checkout {
  restaurant: Restaurant | null;
  delivery: CheckoutDelivery;
  address: CheckoutAddress;
  schedule: CheckoutSchedule;
  payment: CheckoutPayment;
  tip: CheckoutTip;
  promo: CheckoutPromo;
  summary: CheckoutSummary;
  submission: CheckoutSubmission;
}

export const useCheckout = (): Checkout => {
  const router = useRouter();
  const { user } = useAuthStore();
  const { items, total, selectedRestaurant, isRestored } = useCartContents();
  const clearCart = useCartStore((state) => state.clearCart);
  const invalidateOrderHistory = useInvalidateOrderHistory();
  const { addresses, addAddress } = useAddresses();
  const { selectedAddressId, selectAddress } = useAddressSelectionStore();
  const { selectedSchedule } = useScheduleStore();
  const { data: settings } = usePlatformSettings();
  const idempotencyKeyRef = useRef<string>(createIdempotencyKey());
  const { pay, isPaying } = usePayForOrder();

  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('delivery');
  const [leaveAtDoor, setLeaveAtDoor] = useState(false);
  const [sendAsGift, setSendAsGift] = useState(false);
  const [deliveryTime, setDeliveryTime] = useState<DeliveryTimeChoice | null>(null);
  const [tipAmount, setTipAmount] = useState(0);
  const [showCustomTip, setShowCustomTip] = useState(false);
  const [customTipText, setCustomTipText] = useState('');
  const [showAddressOptions, setShowAddressOptions] = useState(false);
  const [addressLabel, setAddressLabel] = useState('');
  const [addressDetail, setAddressDetail] = useState('');
  const [showNewAddressForm, setShowNewAddressForm] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [promoInput, setPromoInput] = useState('');

  const selectedAddress = addresses.find((option) => option.id === selectedAddressId);

  const scheduleLabel = selectedSchedule
    ? `${selectedSchedule.day} • ${selectedSchedule.time}`
    : 'Choose a delivery time';

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

  const { serviceFee, deliveryFee } = useMemo(
    () => orderService.calculateFees({ settings, deliveryMode, distanceKm }),
    [settings, deliveryMode, distanceKm]
  );
  const promo = usePromoCode(selectedRestaurant?.id, total);
  const discount = promo.applied?.discountAmount ?? 0;
  const grandTotal = Math.max(
    0,
    Number((total + serviceFee + deliveryFee + tipAmount - discount).toFixed(2))
  );
  const currency = settings?.currency === 'EUR' ? '€' : (settings?.currency ?? '');

  const cardEnabled = !!settings?.card_payments_enabled;
  const effectivePaymentMethod: PaymentMethod = cardEnabled ? paymentMethod : 'cash';
  const scheduleIsValid = deliveryTime !== 'schedule' || !!selectedSchedule?.isoTimestamp;
  const canCheckout =
    isRestored &&
    items.length > 0 &&
    deliveryTime !== null &&
    scheduleIsValid &&
    !!settings &&
    (deliveryMode === 'pickup' || !!selectedAddress);

  const handleUseCurrentLocation = useCallback(async () => {
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
      Alert.alert(
        'Could not get location',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setIsLocating(false);
    }
  }, [addAddress, selectAddress]);

  const handleSaveAddress = useCallback(async () => {
    if (!addressLabel.trim() || !addressDetail.trim()) {
      Alert.alert('Missing details', 'Please enter both a label and an address.');
      return;
    }

    const created = await addAddress({
      label: addressLabel.trim(),
      address_line: addressDetail.trim(),
    });
    selectAddress(created.id);
    setAddressLabel('');
    setAddressDetail('');
    setShowNewAddressForm(false);
    setShowAddressOptions(false);
  }, [addressLabel, addressDetail, addAddress, selectAddress]);

  const applyCustomTip = useCallback(() => {
    const value = Number(customTipText.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) {
      Alert.alert('Invalid amount', 'Please enter a valid tip amount.');
      return;
    }
    setTipAmount(Number(value.toFixed(2)));
    setShowCustomTip(false);
  }, [customTipText]);

  const explainFees = useCallback(() => {
    Alert.alert(
      'How fees work',
      `Service fee (${serviceFee.toFixed(2)} ${currency}) helps us run the app. Delivery fee (${deliveryFee.toFixed(2)} ${currency}) is based on the distance between the restaurant and your address. Final amounts are confirmed by our servers when you place the order.`
    );
  }, [serviceFee, deliveryFee, currency]);

  const applyPromo = useCallback(async () => {
    const evaluation = await promo.apply(promoInput);
    if (evaluation && !evaluation.valid) {
      promo.setError(PROMOTION_MESSAGES[evaluation.reason]);
    }
  }, [promo, promoInput]);

  const removePromo = useCallback(() => {
    promo.clear();
    setPromoInput('');
  }, [promo]);

  const place = useCallback(async () => {
    if (!deliveryTime || !selectedRestaurant || !user || !isRestored) return;
    if (items.length === 0) return;

    const submittedEpoch = currentSessionEpoch();
    setIsSubmitting(true);
    try {
      const order = await orderService.createOrder({
        restaurantId: selectedRestaurant.id,
        items,
        deliveryMode,
        addressId: deliveryMode === 'delivery' ? (selectedAddress?.id ?? null) : null,
        scheduledFor: deliveryTime === 'schedule' ? (selectedSchedule?.isoTimestamp ?? null) : null,
        tipAmount,
        paymentMethod: effectivePaymentMethod,
        leaveAtDoor,
        sendAsGift,
        idempotencyKey: idempotencyKeyRef.current,
        promoCode: promo.applied?.code ?? null,
      });

      if (isStaleSession(submittedEpoch)) return;

      if (order.status === 'pending_payment') {
        const outcome = await pay(order.id, selectedRestaurant.name);

        if (isStaleSession(submittedEpoch)) return;

        if (outcome.status === 'cancelled') {
          Alert.alert(
            'Payment cancelled',
            'Your basket is saved. Tap Place order again to finish paying.'
          );
          return;
        }

        if (outcome.status === 'failed') {
          Alert.alert('Payment failed', outcome.message);
          return;
        }
      }

      idempotencyKeyRef.current = createIdempotencyKey();
      invalidateOrderHistory();
      promo.clear();
      setPromoInput('');
      clearCart();
      router.dismissTo('/restaurants');
      router.push(`/order/track?id=${order.id}`);
    } catch (error) {
      if (isStaleSession(submittedEpoch)) return;
      Alert.alert('Order failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    deliveryTime,
    selectedRestaurant,
    user,
    isRestored,
    items,
    deliveryMode,
    selectedAddress,
    selectedSchedule,
    tipAmount,
    effectivePaymentMethod,
    leaveAtDoor,
    sendAsGift,
    promo,
    pay,
    invalidateOrderHistory,
    clearCart,
    router,
  ]);

  const chooseSchedule = useCallback(() => {
    setDeliveryTime('schedule');
    router.push('/order/schedule');
  }, [router]);

  return {
    restaurant: selectedRestaurant,
    delivery: {
      mode: deliveryMode,
      setMode: setDeliveryMode,
      leaveAtDoor,
      setLeaveAtDoor,
      sendAsGift,
      setSendAsGift,
    },
    address: {
      addresses,
      selected: selectedAddress,
      selectedId: selectedAddressId,
      select: (id) => {
        selectAddress(id);
        setShowAddressOptions(false);
      },
      isOpen: showAddressOptions,
      toggle: () => setShowAddressOptions((value) => !value),
      isLocating,
      useCurrentLocation: handleUseCurrentLocation,
      isFormOpen: showNewAddressForm,
      toggleForm: () => setShowNewAddressForm((value) => !value),
      label: addressLabel,
      setLabel: setAddressLabel,
      detail: addressDetail,
      setDetail: setAddressDetail,
      save: handleSaveAddress,
    },
    schedule: {
      choice: deliveryTime,
      label: scheduleLabel,
      hasSelection: !!selectedSchedule,
      chooseStandard: () => setDeliveryTime('standard'),
      chooseSchedule,
    },
    payment: {
      method: effectivePaymentMethod,
      setMethod: setPaymentMethod,
      cardEnabled,
    },
    tip: {
      amount: tipAmount,
      presets: TIP_PRESETS,
      isCustomOpen: showCustomTip,
      toggleCustom: () => setShowCustomTip((value) => !value),
      selectPreset: (amount) => {
        setTipAmount(amount);
        setShowCustomTip(false);
      },
      customText: customTipText,
      setCustomText: setCustomTipText,
      applyCustom: applyCustomTip,
    },
    promo: {
      input: promoInput,
      setInput: (value) => setPromoInput(value.toUpperCase()),
      applied: promo.applied,
      error: promo.error,
      isChecking: promo.isChecking,
      apply: applyPromo,
      remove: removePromo,
    },
    summary: {
      subtotal: total,
      serviceFee,
      deliveryFee,
      tipAmount,
      discount,
      grandTotal,
      currency,
      promoCode: promo.applied?.code ?? null,
      explainFees,
    },
    submission: {
      place,
      canPlace: canCheckout,
      isBusy: isSubmitting || isPaying,
      deliveryTimeSelected: deliveryTime !== null,
      label: `${effectivePaymentMethod === 'card' ? 'Pay' : 'Place order'} · ${grandTotal.toFixed(2)} ${currency}`,
    },
  };
};
