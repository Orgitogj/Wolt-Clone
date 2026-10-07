import { RatingStars } from '@/components/reviews/RatingStars';
import { Colors } from '@/constants/theme';
import { useManagedReviews, useModerateReview, useRespondToReview } from '@/hooks/useReviews';
import type { ManagedReview, ReviewStatus } from '@/types/database';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface ReviewManagementListProps {
  restaurantId: string | null;
  canRespond?: boolean;
  canModerate?: boolean;
  enabled?: boolean;
}

const STATUS_LABEL: Record<ReviewStatus, string> = {
  visible: 'Visible',
  hidden: 'Hidden',
  removed: 'Removed',
};

export const ReviewManagementList = ({
  restaurantId,
  canRespond = false,
  canModerate = false,
  enabled = true,
}: ReviewManagementListProps) => {
  const { data, isLoading, error, refetch, isRefetching } = useManagedReviews(restaurantId, enabled);
  const respond = useRespondToReview(restaurantId ?? undefined);
  const moderate = useModerateReview(restaurantId ?? undefined);

  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const submitReply = async (reviewId: string) => {
    const body = replyText.trim();
    if (!body) return;

    try {
      await respond.mutateAsync({ reviewId, body });
      setReplyingTo(null);
      setReplyText('');
    } catch (replyError) {
      Alert.alert(
        'We could not save your response',
        replyError instanceof Error ? replyError.message : 'Please try again.'
      );
    }
  };

  const applyModeration = async (reviewId: string, status: ReviewStatus) => {
    try {
      await moderate.mutateAsync({
        reviewId,
        status,
        reason: status === 'visible' ? undefined : 'Moderated from the admin console',
      });
    } catch (moderationError) {
      Alert.alert(
        'We could not moderate this review',
        moderationError instanceof Error ? moderationError.message : 'Please try again.'
      );
    }
  };

  if (isLoading) {
    return (
      <View style={styles.state} testID="managed-reviews-loading">
        <ActivityIndicator color={Colors.secondary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.state}>
        <Text style={styles.mutedText}>We could not load reviews.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()} accessibilityRole="button">
          <Text style={styles.retryButtonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const reviews = data ?? [];

  if (reviews.length === 0) {
    return (
      <View style={styles.state}>
        <Ionicons name="chatbubble-ellipses-outline" size={32} color={Colors.muted} />
        <Text style={styles.mutedText}>No reviews yet.</Text>
      </View>
    );
  }

  const renderItem = ({ item }: { item: ManagedReview }) => (
    <View style={styles.card} testID={`managed-review-${item.id}`}>
      <View style={styles.cardHeader}>
        <Text style={styles.name}>{item.reviewer_name}</Text>
        <View style={[styles.statusBadge, item.status !== 'visible' && styles.statusBadgeMuted]}>
          <Text style={styles.statusBadgeText}>{STATUS_LABEL[item.status]}</Text>
        </View>
      </View>

      <RatingStars rating={item.rating} size={14} />
      {!!item.body && <Text style={styles.body}>{item.body}</Text>}
      {!!item.moderation_reason && (
        <Text style={styles.moderationReason}>Moderation note: {item.moderation_reason}</Text>
      )}

      {!!item.response_body && (
        <View style={styles.response}>
          <Text style={styles.responseTitle}>Your response</Text>
          <Text style={styles.responseBody}>{item.response_body}</Text>
        </View>
      )}

      {canRespond && item.status === 'visible' && (
        <>
          {replyingTo === item.id ? (
            <View style={styles.replyBox}>
              <TextInput
                style={styles.replyInput}
                value={replyText}
                onChangeText={(text) => setReplyText(text.slice(0, 1000))}
                placeholder="Write a response"
                placeholderTextColor={Colors.muted}
                multiline
                editable={!respond.isPending}
                testID={`reply-input-${item.id}`}
              />
              <View style={styles.replyActions}>
                <TouchableOpacity
                  onPress={() => {
                    setReplyingTo(null);
                    setReplyText('');
                  }}
                  disabled={respond.isPending}
                  accessibilityRole="button">
                  <Text style={styles.secondaryAction}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.smallButton, (!replyText.trim() || respond.isPending) && styles.disabled]}
                  onPress={() => submitReply(item.id)}
                  disabled={!replyText.trim() || respond.isPending}
                  accessibilityRole="button"
                  testID={`reply-submit-${item.id}`}>
                  <Text style={styles.smallButtonText}>
                    {respond.isPending ? 'Saving...' : 'Send'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => {
                setReplyingTo(item.id);
                setReplyText(item.response_body ?? '');
              }}
              accessibilityRole="button"
              testID={`reply-${item.id}`}>
              <Text style={styles.primaryAction}>
                {item.response_body ? 'Edit response' : 'Respond'}
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {canModerate && (
        <View style={styles.moderationRow}>
          {item.status !== 'visible' && (
            <TouchableOpacity
              style={styles.smallButton}
              onPress={() => applyModeration(item.id, 'visible')}
              disabled={moderate.isPending}
              accessibilityRole="button"
              testID={`restore-${item.id}`}>
              <Text style={styles.smallButtonText}>Restore</Text>
            </TouchableOpacity>
          )}
          {item.status !== 'hidden' && (
            <TouchableOpacity
              style={[styles.smallButton, styles.warningButton]}
              onPress={() => applyModeration(item.id, 'hidden')}
              disabled={moderate.isPending}
              accessibilityRole="button"
              testID={`hide-${item.id}`}>
              <Text style={styles.smallButtonText}>Hide</Text>
            </TouchableOpacity>
          )}
          {item.status !== 'removed' && (
            <TouchableOpacity
              style={[styles.smallButton, styles.destructiveButton]}
              onPress={() => applyModeration(item.id, 'removed')}
              disabled={moderate.isPending}
              accessibilityRole="button"
              testID={`remove-${item.id}`}>
              <Text style={styles.smallButtonText}>Remove</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );

  return (
    <FlatList
      testID="managed-reviews-list"
      data={reviews}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      contentContainerStyle={styles.listContent}
      refreshing={isRefetching}
      onRefresh={refetch}
      showsVerticalScrollIndicator={false}
    />
  );
};

const styles = StyleSheet.create({
  listContent: { padding: 16, gap: 12 },
  state: { padding: 24, alignItems: 'center', gap: 8 },
  mutedText: { fontSize: 13, color: Colors.muted, textAlign: 'center' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 15, fontWeight: '700', color: '#000' },
  statusBadge: {
    backgroundColor: '#E5F3EA',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  statusBadgeMuted: { backgroundColor: '#FBE9EB' },
  statusBadgeText: { fontSize: 11, fontWeight: '600', color: '#333' },
  body: { fontSize: 14, color: '#333', lineHeight: 20 },
  moderationReason: { fontSize: 12, color: '#B32433' },
  response: { backgroundColor: Colors.background, borderRadius: 10, padding: 10, gap: 4 },
  responseTitle: { fontSize: 12, fontWeight: '700', color: Colors.secondary },
  responseBody: { fontSize: 13, color: '#333' },
  replyBox: { gap: 8 },
  replyInput: {
    minHeight: 70,
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  replyActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 16 },
  primaryAction: { fontSize: 13, fontWeight: '700', color: Colors.secondary },
  secondaryAction: { fontSize: 13, color: Colors.muted },
  moderationRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  smallButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: Colors.secondary,
  },
  warningButton: { backgroundColor: '#8A6100' },
  destructiveButton: { backgroundColor: '#B32433' },
  smallButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.primary,
  },
  retryButtonText: { color: '#fff', fontWeight: '600' },
});
