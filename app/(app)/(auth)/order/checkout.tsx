import { AddressSection } from '@/components/checkout/AddressSection';
import { CartValidationBanner } from '@/components/checkout/CartValidationBanner';
import { DeliveryOptionsSection } from '@/components/checkout/DeliveryOptionsSection';
import { OrderSummary } from '@/components/checkout/OrderSummary';
import { PaymentSection } from '@/components/checkout/PaymentSection';
import { PlaceOrderBar } from '@/components/checkout/PlaceOrderBar';
import { PromoSection } from '@/components/checkout/PromoSection';
import { ScheduleSection } from '@/components/checkout/ScheduleSection';
import { TipSection } from '@/components/checkout/TipSection';
import { Colors } from '@/constants/theme';
import { useCheckout } from '@/hooks/useCheckout';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

const MAP_HEIGHT = 250;

const Page = () => {
  const checkout = useCheckout();
  const scrollOffset = useSharedValue(0);

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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: checkout.restaurant?.name }} />
      <Animated.View style={[styles.mapContainer, mapStyle]}>
        <View style={styles.mapPlaceholder}>
          <View style={styles.mapPin}>
            <Ionicons name="location" size={24} color={Colors.secondary} />
          </View>
          <Text style={styles.mapPlaceholderText}>
            {checkout.restaurant?.name ?? 'Selected restaurant'}
          </Text>
          <Text style={styles.mapPlaceholderAddress}>
            {checkout.restaurant?.address ?? 'Choose a restaurant to see its address'}
          </Text>
        </View>
      </Animated.View>

      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.scrollContent, { paddingTop: MAP_HEIGHT }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <View style={styles.contentContainer}>
          <CartValidationBanner state={checkout.cart} />
          <AddressSection delivery={checkout.delivery} address={checkout.address} />
          <DeliveryOptionsSection delivery={checkout.delivery} />
          <ScheduleSection schedule={checkout.schedule} />
          <PaymentSection
            payment={checkout.payment}
            grandTotal={checkout.summary.grandTotal}
            currency={checkout.summary.currency}
          />
          <TipSection tip={checkout.tip} />
          <PromoSection promo={checkout.promo} />
          <OrderSummary summary={checkout.summary} />

          <View style={{ height: 100 }} />
        </View>
      </Animated.ScrollView>

      <PlaceOrderBar submission={checkout.submission} />
    </KeyboardAvoidingView>
  );
};

export default Page;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
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
});
