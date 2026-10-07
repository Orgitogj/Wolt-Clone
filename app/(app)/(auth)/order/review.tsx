import { RatingStars } from '@/components/reviews/RatingStars';
import { Colors } from '@/constants/theme';
import {
  useDeleteReview,
  useMyReviews,
  useReviewEligibility,
  useSubmitReview,
  useUpdateReview,
} from '@/hooks/useReviews';
import { useOrderTracking } from '@/hooks/useOrderTracking';
import { REVIEW_BODY_MAX_LENGTH } from '@/services/reviewService';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const INELIGIBLE_MESSAGE: Record<string, string> = {
  not_found: 'We could not find that order.',
  not_your_order: 'You can only review your own orders.',
  not_delivered: 'You can review this order once it has been delivered.',
};

const Page = () => {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = id ?? '';

  const { order } = useOrderTracking(orderId);
  const {
    data: eligibility,
    isLoading: eligibilityLoading,
    error: eligibilityError,
    refetch,
  } = useReviewEligibility(orderId);
  const { data: myReviews } = useMyReviews();

  const restaurantId = order?.restaurant_id;
  const submitReview = useSubmitReview(restaurantId);
  const updateReview = useUpdateReview(restaurantId);
  const deleteReview = useDeleteReview(restaurantId);

  const existing = myReviews?.find((review) => review.order_id === orderId);
  const isEditing = !!existing;

  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [hasLoadedExisting, setHasLoadedExisting] = useState(false);

  useEffect(() => {
    if (existing && !hasLoadedExisting) {
      setRating(existing.rating);
      setBody(existing.body ?? '');
      setHasLoadedExisting(true);
    }
  }, [existing, hasLoadedExisting]);

  const isPending = submitReview.isPending || updateReview.isPending || deleteReview.isPending;
  const canSubmit = rating >= 1 && rating <= 5 && !isPending;

  const onSubmit = async () => {
    if (!canSubmit) return;

    try {
      if (isEditing && existing) {
        await updateReview.mutateAsync({ reviewId: existing.id, rating, body: body.trim() || null });
      } else {
        await submitReview.mutateAsync({ orderId, rating, body: body.trim() || null });
      }
      router.back();
    } catch (error) {
      Alert.alert(
        'We could not save your review',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  };

  const onDelete = () => {
    if (!existing) return;

    Alert.alert('Delete review', 'This removes your rating and comment for this order.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteReview.mutateAsync(existing.id);
            router.back();
          } catch (error) {
            Alert.alert(
              'We could not delete your review',
              error instanceof Error ? error.message : 'Please try again.'
            );
          }
        },
      },
    ]);
  };

  if (eligibilityLoading) {
    return (
      <View style={styles.state} testID="review-eligibility-loading">
        <Stack.Screen options={{ title: 'Rate your order' }} />
        <ActivityIndicator size="large" color={Colors.secondary} />
      </View>
    );
  }

  if (eligibilityError) {
    return (
      <View style={styles.state}>
        <Stack.Screen options={{ title: 'Rate your order' }} />
        <Ionicons name="cloud-offline-outline" size={40} color={Colors.muted} />
        <Text style={styles.mutedText}>We could not check this order.</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => refetch()}
          accessibilityRole="button">
          <Text style={styles.primaryButtonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const blockedReason = eligibility?.reason;
  const isBlocked =
    !eligibility?.can_review && blockedReason !== 'already_reviewed' && !isEditing;

  if (isBlocked) {
    return (
      <View style={styles.state}>
        <Stack.Screen options={{ title: 'Rate your order' }} />
        <Ionicons name="lock-closed-outline" size={40} color={Colors.muted} />
        <Text style={styles.mutedText}>
          {INELIGIBLE_MESSAGE[blockedReason ?? 'not_found'] ?? 'This order cannot be reviewed.'}
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: isEditing ? 'Edit your review' : 'Rate your order' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{order?.restaurant?.name ?? 'Your order'}</Text>
        <Text style={styles.mutedText}>How was it?</Text>

        <View style={styles.starsRow}>
          <RatingStars
            rating={rating}
            size={36}
            onChange={setRating}
            disabled={isPending}
            testID="review-rating-input"
          />
        </View>

        <TextInput
          style={styles.input}
          value={body}
          onChangeText={(text) => setBody(text.slice(0, REVIEW_BODY_MAX_LENGTH))}
          placeholder="Tell others about the food and the delivery (optional)"
          placeholderTextColor={Colors.muted}
          multiline
          editable={!isPending}
          testID="review-body-input"
        />
        <Text style={styles.counter}>
          {body.length}/{REVIEW_BODY_MAX_LENGTH}
        </Text>

        <TouchableOpacity
          style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]}
          onPress={onSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit }}
          testID="review-submit">
          {isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>
              {isEditing ? 'Save changes' : 'Submit review'}
            </Text>
          )}
        </TouchableOpacity>

        {isEditing && (
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={onDelete}
            disabled={isPending}
            accessibilityRole="button">
            <Text style={styles.deleteButtonText}>Delete review</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20, gap: 12 },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: Colors.background,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#000' },
  mutedText: { fontSize: 14, color: Colors.muted, textAlign: 'center' },
  starsRow: { alignItems: 'center', paddingVertical: 12 },
  input: {
    minHeight: 120,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    textAlignVertical: 'top',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light,
  },
  counter: { alignSelf: 'flex-end', fontSize: 12, color: Colors.muted },
  primaryButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  deleteButton: { paddingVertical: 14, alignItems: 'center' },
  deleteButtonText: { color: '#B32433', fontWeight: '600' },
});

export default Page;
