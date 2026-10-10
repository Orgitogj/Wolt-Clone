import { Colors } from '@/constants/theme';
import type { CheckoutTip } from '@/hooks/useCheckout';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export interface TipSectionProps {
  tip: CheckoutTip;
}

export const TipSection = ({ tip }: TipSectionProps) => (
  <View style={styles.section}>
    <Text style={styles.sectionHeader}>Add courier tip</Text>
    <Text style={styles.tipDescription}>
      100% of your tip goes to your courier. Its an easy way to say thanks for great service.
    </Text>

    <View style={styles.tipButtons}>
      {tip.presets.map((amount) => (
        <TouchableOpacity
          key={amount}
          style={[
            styles.tipButton,
            tip.amount === amount && !tip.isCustomOpen && styles.tipButtonActive,
          ]}
          onPress={() => tip.selectPreset(amount)}>
          <Text
            style={[
              styles.tipButtonText,
              tip.amount === amount && !tip.isCustomOpen && styles.tipButtonTextActive,
            ]}>
            {amount === 0 ? 'No tip' : `${amount} €`}
          </Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity
        style={[styles.tipButton, tip.isCustomOpen && styles.tipButtonActive]}
        onPress={tip.toggleCustom}>
        <Text style={[styles.tipButtonText, tip.isCustomOpen && styles.tipButtonTextActive]}>
          Custom
        </Text>
      </TouchableOpacity>
    </View>

    {tip.isCustomOpen && (
      <View style={styles.customTipRow}>
        <TextInput
          style={styles.customTipInput}
          placeholder="Amount in €"
          keyboardType="decimal-pad"
          value={tip.customText}
          onChangeText={tip.setCustomText}
        />
        <TouchableOpacity style={styles.saveAddressButton} onPress={tip.applyCustom}>
          <Text style={styles.saveAddressButtonText}>Set tip</Text>
        </TouchableOpacity>
      </View>
    )}
  </View>
);

const styles = StyleSheet.create({
  section: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  sectionHeader: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    marginBottom: 16,
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
});
