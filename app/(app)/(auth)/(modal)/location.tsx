import { Colors, Fonts } from '@/constants/theme';
import { useAddressSelectionStore } from '@/hooks/use-address-store';
import { useAddresses } from '@/hooks/useAddresses';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const Page = () => {
  const router = useRouter();
  const { addresses, isLoading, addAddress, removeAddress } = useAddresses();
  const { selectedAddressId, selectAddress } = useAddressSelectionStore();
  const [isLocating, setIsLocating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [addressLine, setAddressLine] = useState('');

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
      router.dismiss();
    } catch (error) {
      Alert.alert('Could not get location', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsLocating(false);
    }
  };

  const handleSaveAddress = async () => {
    if (!label.trim() || !addressLine.trim()) {
      Alert.alert('Missing details', 'Please enter both a label and an address.');
      return;
    }
    const created = await addAddress({ label: label.trim(), address_line: addressLine.trim() });
    selectAddress(created.id);
    setLabel('');
    setAddressLine('');
    setShowForm(false);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.title}>Location</Text>

      {/* Use Current Location */}
      <TouchableOpacity
        style={styles.locationItem}
        onPress={handleUseCurrentLocation}
        disabled={isLocating}>
        <View style={styles.locationItemIcon}>
          {isLocating ? (
            <ActivityIndicator size="small" color={Colors.secondary} />
          ) : (
            <Ionicons name="locate-outline" size={18} color="#000" />
          )}
        </View>
        <Text style={styles.locationText}>Use my current location</Text>
      </TouchableOpacity>

      {/* Saved Addresses */}
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 16 }} color={Colors.secondary} />
      ) : (
        addresses.map((address) => (
          <View key={address.id} style={styles.locationItem}>
            <TouchableOpacity
              style={styles.addressTouchArea}
              onPress={() => {
                selectAddress(address.id);
                router.dismiss();
              }}>
              <View style={styles.locationItemIcon}>
                <Ionicons name="location-outline" size={18} color="#000" />
              </View>
              <View style={styles.addressInfo}>
                <Text style={styles.addressText}>{address.label}</Text>
                <Text style={styles.cityText}>{address.address_line}</Text>
              </View>
            </TouchableOpacity>
            {address.id === selectedAddressId && (
              <Ionicons name="checkmark-circle" size={20} color={Colors.secondary} />
            )}
            <TouchableOpacity onPress={() => removeAddress(address.id)} style={styles.deleteButton}>
              <Ionicons name="trash-outline" size={18} color={Colors.muted} />
            </TouchableOpacity>
          </View>
        ))
      )}

      {/* Add New Address */}
      <TouchableOpacity style={styles.locationItem} onPress={() => setShowForm((v) => !v)}>
        <View style={styles.locationItemIcon}>
          <Ionicons name={showForm ? 'close' : 'add'} size={18} color="#000" />
        </View>
        <Text style={styles.locationText}>Add new address</Text>
      </TouchableOpacity>

      {showForm && (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Label (Home, Work...)"
            value={label}
            onChangeText={setLabel}
          />
          <TextInput
            style={styles.input}
            placeholder="Address"
            value={addressLine}
            onChangeText={setAddressLine}
          />
          <TouchableOpacity style={styles.saveButton} onPress={handleSaveAddress}>
            <Text style={styles.saveButtonText}>Save address</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20,
  },
  title: {
    fontFamily: Fonts.brandBold,
    fontSize: 32,
    fontWeight: 900,
    marginBottom: 12,
  },
  locationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 16,
  },
  addressTouchArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  deleteButton: {
    padding: 4,
  },
  locationItemIcon: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: Colors.light,
  },
  locationText: {
    fontSize: 16,
    color: '#000',
  },
  addressInfo: {
    flex: 1,
  },
  addressText: {
    fontSize: 16,
    color: '#000',
    marginBottom: 2,
  },
  cityText: {
    fontSize: 14,
    color: '#999',
  },
  form: {
    paddingTop: 12,
    gap: 8,
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
  saveButton: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.secondary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default Page;
