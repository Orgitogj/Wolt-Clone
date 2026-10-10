import { Colors } from '@/constants/theme';
import type { CheckoutAddress, CheckoutDelivery } from '@/hooks/useCheckout';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export interface AddressSectionProps {
  delivery: CheckoutDelivery;
  address: CheckoutAddress;
}

export const AddressSection = ({ delivery, address }: AddressSectionProps) => (
  <>
    <View style={styles.section}>
      <View style={styles.pickerContainer}>
        <TouchableOpacity
          style={[styles.pickerOption, delivery.mode === 'delivery' && styles.pickerOptionActive]}
          onPress={() => delivery.setMode('delivery')}>
          <Text
            style={[
              styles.pickerOptionText,
              delivery.mode === 'delivery' && styles.pickerOptionTextActive,
            ]}>
            Delivery
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pickerOption, delivery.mode === 'pickup' && styles.pickerOptionActive]}
          onPress={() => delivery.setMode('pickup')}>
          <Text
            style={[
              styles.pickerOptionText,
              delivery.mode === 'pickup' && styles.pickerOptionTextActive,
            ]}>
            Pickup
          </Text>
        </TouchableOpacity>
      </View>
    </View>

    {delivery.mode === 'delivery' && (
      <TouchableOpacity style={styles.section} onPress={address.toggle} activeOpacity={0.8}>
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <View style={styles.addressIcon}>
              <Ionicons name="location-outline" size={18} color={Colors.secondary} />
            </View>
            <View style={styles.addressTextContainer}>
              <Text style={styles.sectionTitle}>Choose a delivery address</Text>
              <Text style={styles.sectionSubtitle}>
                {address.selected?.address_line ?? 'No address selected yet'}
              </Text>
            </View>
          </View>
          <Ionicons
            name={address.isOpen ? 'chevron-up' : 'chevron-forward'}
            size={20}
            color="#999"
          />
        </View>

        {address.isOpen && (
          <View style={styles.addressOptions}>
            <TouchableOpacity
              style={styles.addressOption}
              onPress={address.useCurrentLocation}
              disabled={address.isLocating}>
              <View style={styles.addressOptionTextContainer}>
                <Text style={styles.addressOptionLabel}>
                  {address.isLocating ? 'Locating…' : 'Use current location'}
                </Text>
              </View>
              <Ionicons name="locate-outline" size={18} color={Colors.secondary} />
            </TouchableOpacity>
            {address.addresses.map((option) => {
              const isSelected = option.id === address.selectedId;

              return (
                <TouchableOpacity
                  key={option.id}
                  style={[styles.addressOption, isSelected && styles.addressOptionActive]}
                  onPress={() => address.select(option.id)}>
                  <View style={styles.addressOptionTextContainer}>
                    <Text
                      style={[
                        styles.addressOptionLabel,
                        isSelected && styles.addressOptionLabelActive,
                      ]}>
                      {option.label}
                    </Text>
                    <Text style={styles.addressOptionDetail}>{option.address_line}</Text>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={20} color={Colors.secondary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {address.isOpen && (
          <View style={styles.addressActions}>
            <TouchableOpacity style={styles.secondaryAction} onPress={address.toggleForm}>
              <Ionicons name="add-circle-outline" size={16} color={Colors.secondary} />
              <Text style={styles.secondaryActionText}>Add new address</Text>
            </TouchableOpacity>
            {address.isFormOpen && (
              <View style={styles.addressForm}>
                <TextInput
                  style={styles.input}
                  placeholder="Label (Home, Work...)"
                  value={address.label}
                  onChangeText={address.setLabel}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Address details"
                  value={address.detail}
                  onChangeText={address.setDetail}
                />
                <TouchableOpacity style={styles.saveAddressButton} onPress={address.save}>
                  <Text style={styles.saveAddressButtonText}>Save address</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
    )}
  </>
);

const styles = StyleSheet.create({
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
  sectionSubtitle: {
    fontSize: 14,
    color: '#999',
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
});
