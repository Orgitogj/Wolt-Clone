import { RatingStars } from '@/components/reviews/RatingStars';
import { Colors } from '@/constants/theme';
import type { PublicReview } from '@/types/database';
import { StyleSheet, Text, View } from 'react-native';

interface ReviewCardProps {
  review: PublicReview;
  footer?: React.ReactNode;
}

const formatDate = (value: string) => new Date(value).toLocaleDateString();

export const ReviewCard = ({ review, footer }: ReviewCardProps) => (
  <View style={styles.card} testID={`review-${review.id}`}>
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <Text style={styles.name}>{review.reviewer_name}</Text>
        {review.is_mine && (
          <View style={styles.mineBadge}>
            <Text style={styles.mineBadgeText}>Your review</Text>
          </View>
        )}
      </View>
      <Text style={styles.date}>{formatDate(review.created_at)}</Text>
    </View>

    <RatingStars rating={review.rating} size={14} />

    {!!review.body && <Text style={styles.body}>{review.body}</Text>}

    {!!review.response_body && (
      <View style={styles.response}>
        <Text style={styles.responseTitle}>Response from the restaurant</Text>
        <Text style={styles.responseBody}>{review.response_body}</Text>
      </View>
    )}

    {footer}
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
  },
  mineBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  mineBadgeText: {
    fontSize: 11,
    color: Colors.secondary,
    fontWeight: '600',
  },
  date: {
    fontSize: 12,
    color: Colors.muted,
  },
  body: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  response: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  responseTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.secondary,
  },
  responseBody: {
    fontSize: 13,
    color: '#333',
    lineHeight: 18,
  },
});
