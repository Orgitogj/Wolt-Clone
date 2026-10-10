import { Colors } from '@/constants/theme';
import type { CheckoutPromo } from '@/hooks/useCheckout';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export interface PromoSectionProps {
  promo: CheckoutPromo;
}

export const PromoSection = ({ promo }: PromoSectionProps) => (
  <View style={styles.section}>
    <Text style={styles.promoTitle}>Promo code</Text>
    {promo.applied ? (
      <View style={styles.promoAppliedRow}>
        <View style={styles.promoAppliedBadge}>
          <Ionicons name="pricetag" size={14} color={Colors.secondary} />
          <Text style={styles.promoAppliedCode}>{promo.applied.code}</Text>
        </View>
        <Text style={styles.promoAppliedText} numberOfLines={1}>
          {promo.applied.description ?? 'Discount applied'}
        </Text>
        <TouchableOpacity onPress={promo.remove} accessibilityRole="button" testID="remove-promo">
          <Text style={styles.promoRemove}>Remove</Text>
        </TouchableOpacity>
      </View>
    ) : (
      <View style={styles.promoRow}>
        <TextInput
          style={styles.promoInput}
          value={promo.input}
          onChangeText={promo.setInput}
          placeholder="Enter a code"
          placeholderTextColor={Colors.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!promo.isChecking}
          testID="promo-input"
        />
        <TouchableOpacity
          style={[
            styles.promoApplyButton,
            (!promo.input.trim() || promo.isChecking) && styles.promoApplyDisabled,
          ]}
          disabled={!promo.input.trim() || promo.isChecking}
          onPress={promo.apply}
          accessibilityRole="button"
          testID="apply-promo">
          <Text style={styles.promoApplyText}>{promo.isChecking ? 'Checking' : 'Apply'}</Text>
        </TouchableOpacity>
      </View>
    )}
    {!!promo.error && <Text style={styles.promoError}>{promo.error}</Text>}
  </View>
);

const styles = StyleSheet.create({
  section: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  promoTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
    marginBottom: 10,
  },
  promoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  promoInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  promoApplyButton: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.secondary,
  },
  promoApplyDisabled: {
    opacity: 0.5,
  },
  promoApplyText: {
    color: '#fff',
    fontWeight: '700',
  },
  promoAppliedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  promoAppliedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  promoAppliedCode: {
    fontWeight: '700',
    color: Colors.secondary,
    fontSize: 13,
  },
  promoAppliedText: {
    flex: 1,
    fontSize: 13,
    color: Colors.muted,
  },
  promoRemove: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B32433',
  },
  promoError: {
    marginTop: 8,
    fontSize: 13,
    color: '#B32433',
  },
});
