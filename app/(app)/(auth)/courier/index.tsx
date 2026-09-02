import {
  COURIER_NEXT_STEP,
  DELIVERY_STATUS_LABELS,
  VEHICLE_LABELS,
  VEHICLE_OPTIONS,
  VERIFICATION_LABELS,
} from '@/constants/deliveryStatus';
import { Colors } from '@/constants/theme';
import {
  useActiveDelivery,
  useAdvanceDelivery,
  useCourierLocationSync,
  useCourierProfile,
  useDeliveryOffers,
  useRegisterCourier,
  useRespondToOffer,
  useSetAvailability,
} from '@/hooks/useCourier';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import type { CourierVehicleType, DeliveryOfferWithContext } from '@/types/database';
import { openDirections } from '@/utils/navigation';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const Page = () => {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const { courier, isLoading, isCourier, isApproved } = useCourierProfile();
  const { data: settings } = usePlatformSettings();
  const register = useRegisterCourier();
  const setAvailability = useSetAvailability();
  const respond = useRespondToOffer();
  const advance = useAdvanceDelivery();

  const isOnline = courier?.availability === 'online' || courier?.availability === 'busy';
  const { data: activeDelivery } = useActiveDelivery();
  const { data: offers } = useDeliveryOffers(isApproved && isOnline && !activeDelivery);

  useCourierLocationSync(isApproved && isOnline);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [plate, setPlate] = useState('');
  const [vehicle, setVehicle] = useState<CourierVehicleType>('bicycle');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!offers || offers.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [offers]);

  const currency = settings?.currency === 'EUR' ? '€' : (settings?.currency ?? '');

  const onRegister = async () => {
    if (!fullName.trim()) {
      Alert.alert('Name required', 'Enter the name that appears on your ID.');
      return;
    }
    try {
      await register.mutateAsync({
        fullName: fullName.trim(),
        phone: phone.trim() || null,
        vehicleType: vehicle,
        vehiclePlate: plate.trim() || null,
      });
    } catch (error) {
      Alert.alert('Could not register', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const onToggleOnline = async (value: boolean) => {
    try {
      await setAvailability.mutateAsync(value ? 'online' : 'offline');
    } catch (error) {
      Alert.alert('Could not change status', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const onRespond = async (offer: DeliveryOfferWithContext, accept: boolean) => {
    try {
      await respond.mutateAsync({ offerId: offer.id, accept });
    } catch (error) {
      Alert.alert(
        accept ? 'Could not accept' : 'Could not decline',
        error instanceof Error ? error.message : 'Try again.'
      );
    }
  };

  const onAdvance = async () => {
    if (!activeDelivery) return;
    const step = COURIER_NEXT_STEP[activeDelivery.status];
    if (!step) return;
    try {
      await advance.mutateAsync({ deliveryId: activeDelivery.id, to: step.to });
    } catch (error) {
      Alert.alert('Could not update', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const openMaps = async (latitude: number | null, longitude: number | null, label: string) => {
    const opened = await openDirections(latitude, longitude, label);
    if (!opened) Alert.alert('No location', 'This stop has no coordinates saved.');
  };

  const header = (
    <View style={[styles.header, { paddingTop: top + 8 }]}>
      <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={24} color="#000" />
      </TouchableOpacity>
      <View style={styles.headerText}>
        <Text style={styles.title}>Courier</Text>
        <Text style={styles.subtitle}>{courier?.full_name ?? 'Get started'}</Text>
      </View>
      <TouchableOpacity style={styles.iconButton} onPress={() => router.push('/courier/earnings')}>
        <Ionicons name="wallet-outline" size={22} color={Colors.secondary} />
      </TouchableOpacity>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.secondary} />
      </View>
    );
  }

  if (!isCourier) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {header}
        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <Text style={styles.formTitle}>Deliver with us</Text>
          <Text style={styles.formHint}>
            Tell us who you are and what you ride. An administrator reviews every application before
            you can take deliveries.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Full name"
            placeholderTextColor={Colors.muted}
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
          />
          <TextInput
            style={styles.input}
            placeholder="Phone number"
            placeholderTextColor={Colors.muted}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />

          <Text style={styles.label}>Vehicle</Text>
          <View style={styles.vehicleRow}>
            {VEHICLE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.vehicleChip, vehicle === option && styles.vehicleChipActive]}
                onPress={() => setVehicle(option)}>
                <Text
                  style={[styles.vehicleText, vehicle === option && styles.vehicleTextActive]}>
                  {VEHICLE_LABELS[option]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {(vehicle === 'car' || vehicle === 'scooter') && (
            <TextInput
              style={styles.input}
              placeholder="Licence plate"
              placeholderTextColor={Colors.muted}
              value={plate}
              onChangeText={setPlate}
              autoCapitalize="characters"
            />
          )}

          <TouchableOpacity
            style={[styles.primaryButton, register.isPending && styles.buttonDisabled]}
            onPress={onRegister}
            disabled={register.isPending}>
            {register.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Apply</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (!isApproved) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.centered}>
          <Ionicons name="hourglass-outline" size={52} color={Colors.muted} />
          <Text style={styles.emptyTitle}>
            {VERIFICATION_LABELS[courier!.verification_status]}
          </Text>
          <Text style={styles.emptyText}>
            {courier?.verification_notes ??
              'Your application is with our team. You can go online as soon as it is approved.'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {header}
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusCard}>
          <View style={styles.statusText}>
            <Text style={styles.statusTitle}>
              {courier?.availability === 'busy'
                ? 'On a delivery'
                : isOnline
                  ? 'Online'
                  : 'Offline'}
            </Text>
            <Text style={styles.statusHint}>
              {isOnline
                ? 'You will receive delivery offers nearby'
                : 'Go online to start receiving offers'}
            </Text>
          </View>
          <Switch
            value={isOnline}
            onValueChange={onToggleOnline}
            disabled={setAvailability.isPending || courier?.availability === 'busy'}
          />
        </View>

        {activeDelivery ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Current delivery</Text>
            <Text style={styles.cardTitle}>
              {activeDelivery.restaurant?.name ?? 'Restaurant'}
            </Text>
            <Text style={styles.cardStatus}>
              {DELIVERY_STATUS_LABELS[activeDelivery.status]}
            </Text>

            <View style={styles.stopRow}>
              <Ionicons name="restaurant-outline" size={16} color={Colors.muted} />
              <Text style={styles.stopText}>
                {activeDelivery.restaurant?.address ?? 'Pickup'}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  openMaps(
                    activeDelivery.pickup_latitude,
                    activeDelivery.pickup_longitude,
                    activeDelivery.restaurant?.name ?? 'Restaurant'
                  )
                }>
                <Text style={styles.navigate}>Navigate</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.stopRow}>
              <Ionicons name="location-outline" size={16} color={Colors.muted} />
              <Text style={styles.stopText}>{activeDelivery.dropoff_address ?? 'Customer'}</Text>
              <TouchableOpacity
                onPress={() =>
                  openMaps(
                    activeDelivery.dropoff_latitude,
                    activeDelivery.dropoff_longitude,
                    activeDelivery.dropoff_address ?? 'Customer'
                  )
                }>
                <Text style={styles.navigate}>Navigate</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.itemsBox}>
              {activeDelivery.order?.order_items?.map((line) => (
                <Text key={line.id} style={styles.itemLine}>
                  {line.quantity}× {line.dish_name}
                </Text>
              ))}
            </View>

            {COURIER_NEXT_STEP[activeDelivery.status] && (
              <TouchableOpacity
                style={[styles.primaryButton, advance.isPending && styles.buttonDisabled]}
                onPress={onAdvance}
                disabled={advance.isPending}>
                {advance.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {COURIER_NEXT_STEP[activeDelivery.status]!.label}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        ) : (offers ?? []).length > 0 ? (
          (offers ?? []).map((offer) => {
            const secondsLeft = Math.max(
              0,
              Math.round((new Date(offer.expires_at).getTime() - now) / 1000)
            );
            return (
              <View key={offer.id} style={styles.card}>
                <View style={styles.offerHeader}>
                  <Text style={styles.cardLabel}>New delivery</Text>
                  <Text style={styles.countdown}>{secondsLeft}s</Text>
                </View>
                <Text style={styles.cardTitle}>
                  {offer.delivery?.restaurant?.name ?? 'Restaurant'}
                </Text>
                <Text style={styles.cardStatus}>
                  {offer.delivery?.dropoff_address ?? 'Customer address'}
                </Text>
                <View style={styles.offerMeta}>
                  {offer.distance_km != null && (
                    <Text style={styles.offerMetaText}>
                      {Number(offer.distance_km).toFixed(1)} km to pickup
                    </Text>
                  )}
                  {offer.delivery?.distance_km != null && (
                    <Text style={styles.offerMetaText}>
                      {Number(offer.delivery.distance_km).toFixed(1)} km trip
                    </Text>
                  )}
                  {settings && (
                    <Text style={styles.offerMetaText}>
                      ~
                      {(
                        Number(settings.courier_base_fee) +
                        Number(offer.delivery?.distance_km ?? 0) *
                          Number(settings.courier_per_km_fee)
                      ).toFixed(2)}{' '}
                      {currency}
                    </Text>
                  )}
                </View>

                <View style={styles.offerActions}>
                  <TouchableOpacity
                    style={[styles.action, styles.actionGhost]}
                    onPress={() => onRespond(offer, false)}
                    disabled={respond.isPending}>
                    <Text style={styles.actionGhostText}>Decline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.action, styles.actionPrimary]}
                    onPress={() => onRespond(offer, true)}
                    disabled={respond.isPending || secondsLeft === 0}>
                    <Text style={styles.actionPrimaryText}>Accept</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        ) : (
          <View style={styles.emptyBox}>
            <Ionicons
              name={isOnline ? 'bicycle-outline' : 'moon-outline'}
              size={44}
              color={Colors.muted}
            />
            <Text style={styles.emptyTitle}>{isOnline ? 'Waiting for offers' : 'You are offline'}</Text>
            <Text style={styles.emptyText}>
              {isOnline
                ? 'Stay near restaurants to get more delivery offers.'
                : 'Go online to start receiving delivery offers.'}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e6e6e6',
  },
  iconButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerText: { flex: 1, alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: '#000' },
  subtitle: { fontSize: 13, color: Colors.muted, marginTop: 2 },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  form: { padding: 16, gap: 12, paddingBottom: 40 },
  formTitle: { fontSize: 24, fontWeight: '700', color: '#000' },
  formHint: { fontSize: 14, color: Colors.muted, lineHeight: 20, marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.muted, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#000',
  },
  vehicleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vehicleChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  vehicleChipActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  vehicleText: { fontSize: 13, fontWeight: '600', color: '#000' },
  vehicleTextActive: { color: '#fff' },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  statusText: { flex: 1 },
  statusTitle: { fontSize: 17, fontWeight: '700', color: '#000' },
  statusHint: { fontSize: 13, color: Colors.muted, marginTop: 2 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 8 },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.secondary,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#000' },
  cardStatus: { fontSize: 14, color: Colors.muted },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  stopText: { flex: 1, fontSize: 14, color: '#000' },
  navigate: { fontSize: 13, fontWeight: '700', color: Colors.secondary },
  itemsBox: {
    backgroundColor: '#f7f7f7',
    borderRadius: 10,
    padding: 12,
    gap: 4,
    marginTop: 4,
  },
  itemLine: { fontSize: 13, color: '#000' },
  offerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  countdown: { fontSize: 13, fontWeight: '700', color: '#c1272d' },
  offerMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
  offerMetaText: { fontSize: 13, color: Colors.muted, fontWeight: '600' },
  offerActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  action: { flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  actionPrimary: { backgroundColor: Colors.secondary },
  actionPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  actionGhost: { backgroundColor: '#f4f4f4' },
  actionGhostText: { color: Colors.muted, fontSize: 15, fontWeight: '700' },
  primaryButton: {
    backgroundColor: Colors.secondary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  buttonDisabled: { opacity: 0.6 },
  emptyBox: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#000', marginTop: 8 },
  emptyText: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
});

export default Page;
