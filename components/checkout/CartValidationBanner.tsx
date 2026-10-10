import { Colors } from '@/constants/theme';
import type { CartValidationState } from '@/hooks/useCartValidation';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export interface CartValidationBannerProps {
  state: CartValidationState;
}

export const CartValidationBanner = ({ state }: CartValidationBannerProps) => {
  if (state.isChecking && !state.validation) {
    return (
      <View style={styles.checking} testID="cart-validation-checking">
        <ActivityIndicator size="small" color={Colors.secondary} />
        <Text style={styles.checkingText}>Checking your basket</Text>
      </View>
    );
  }

  if (state.error) {
    return (
      <View style={[styles.banner, styles.bannerMuted]} testID="cart-validation-error">
        <View style={styles.header}>
          <Ionicons name="cloud-offline-outline" size={18} color={Colors.muted} />
          <Text style={styles.title}>We could not check your basket</Text>
        </View>
        <TouchableOpacity
          style={styles.secondaryAction}
          onPress={state.recheck}
          accessibilityRole="button"
          testID="cart-validation-retry">
          <Text style={styles.secondaryActionText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!state.needsReview || state.notices.length === 0) return null;

  return (
    <View style={styles.banner} testID="cart-validation-banner">
      <View style={styles.header}>
        <Ionicons name="alert-circle-outline" size={18} color="#B32433" />
        <Text style={styles.title}>Your basket changed</Text>
      </View>

      {state.notices.map((notice) => (
        <Text key={notice} style={styles.notice} testID="cart-validation-notice">
          {notice}
        </Text>
      ))}

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primaryAction}
          onPress={state.updateCart}
          accessibilityRole="button"
          testID="cart-validation-update">
          <Text style={styles.primaryActionText}>Update cart</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryAction}
          onPress={state.acknowledge}
          accessibilityRole="button"
          accessibilityState={{ selected: state.isAcknowledged }}
          testID="cart-validation-acknowledge">
          <Text style={styles.secondaryActionText}>
            {state.isAcknowledged ? 'Reviewed' : 'Keep as is'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#fdf2f3',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#f0c8cc',
  },
  bannerMuted: {
    backgroundColor: Colors.background,
    borderColor: Colors.light,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
  },
  notice: {
    fontSize: 14,
    color: '#444',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
  },
  primaryAction: {
    backgroundColor: Colors.secondary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryActionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryAction: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light,
  },
  secondaryActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  checking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
  },
  checkingText: {
    fontSize: 13,
    color: Colors.muted,
  },
});
