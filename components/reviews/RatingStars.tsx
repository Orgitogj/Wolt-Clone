import { Colors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface RatingStarsProps {
  rating: number;
  size?: number;
  onChange?: (rating: number) => void;
  disabled?: boolean;
  testID?: string;
}

const STAR_COLOR = '#f5a623';

export const RatingStars = ({
  rating,
  size = 16,
  onChange,
  disabled,
  testID,
}: RatingStarsProps) => {
  const values = [1, 2, 3, 4, 5];

  if (!onChange) {
    return (
      <View style={styles.row} testID={testID}>
        {values.map((value) => (
          <Ionicons
            key={value}
            name={value <= Math.round(rating) ? 'star' : 'star-outline'}
            size={size}
            color={STAR_COLOR}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.row} testID={testID}>
      {values.map((value) => (
        <TouchableOpacity
          key={value}
          onPress={() => onChange(value)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`}
          accessibilityState={{ selected: value <= rating, disabled: !!disabled }}
          testID={`rating-star-${value}`}
          hitSlop={6}>
          <Ionicons
            name={value <= rating ? 'star' : 'star-outline'}
            size={size}
            color={disabled ? Colors.muted : STAR_COLOR}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
};

interface RatingSummaryProps {
  average: number;
  count: number;
  size?: number;
}

export const RatingSummary = ({ average, count, size = 14 }: RatingSummaryProps) => (
  <View style={styles.summaryRow}>
    <RatingStars rating={average} size={size} />
    <Text style={styles.summaryText}>
      {count > 0 ? `${average.toFixed(1)} (${count})` : 'No reviews yet'}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryText: {
    fontSize: 13,
    color: Colors.muted,
  },
});
