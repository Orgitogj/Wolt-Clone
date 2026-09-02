import { Colors } from '@/constants/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface PurchaseButtonProps {
  onPress: () => void;
  deliveryTimeSelected: boolean;
  disabled?: boolean;
  isSubmitting?: boolean;
  label?: string;
}

export const PurchaseButton = ({
  onPress,
  deliveryTimeSelected,
  disabled,
  isSubmitting,
  label,
}: PurchaseButtonProps) => {
  const insets = useSafeAreaInsets();

  return (
    <>
      <LinearGradient
        colors={['rgba(255, 255, 255, 0)', 'rgba(255, 255, 255, 0.7)', 'rgba(255, 255, 255, 1)']}
        style={[styles.gradientContainer, { paddingBottom: insets.bottom || 16 }]}
        pointerEvents="none"
      />
      <View style={[styles.container, { paddingBottom: insets.bottom || 16 }]}>
        <TouchableOpacity
          style={[
            styles.button,
            deliveryTimeSelected ? styles.buttonBlack : styles.buttonBlue,
            disabled && styles.buttonDisabled,
          ]}
          onPress={onPress}
          disabled={disabled}
          activeOpacity={0.8}>
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {deliveryTimeSelected ? (label ?? 'Place order') : 'Choose delivery time'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  gradientContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
    paddingTop: 40,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonBlue: {
    backgroundColor: Colors.secondary,
    boxShadow: '0px 4px 12px rgba(0, 157, 224, 0.3)',
  },
  buttonBlack: {
    backgroundColor: '#000',
    boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.3)',
  },
  buttonDisabled: {
    backgroundColor: '#e0e0e0',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
