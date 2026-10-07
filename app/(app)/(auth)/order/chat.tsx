import { Colors } from '@/constants/theme';
import { mergeChatTimeline, useOrderChat } from '@/hooks/useOrderChat';
import { MESSAGE_MAX_LENGTH } from '@/services/chatService';
import type { OrderMessage, OutgoingMessage } from '@/types/database';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type TimelineEntry = OrderMessage | OutgoingMessage;

const isPending = (entry: TimelineEntry): entry is OutgoingMessage =>
  (entry as OutgoingMessage).state !== undefined;

const UNAVAILABLE_COPY: Record<string, { title: string; body: string }> = {
  no_access: {
    title: 'This conversation is not available',
    body: 'You can only open the chat for your own order.',
  },
  no_courier_yet: {
    title: 'No courier yet',
    body: 'Once a courier picks up your order you can message them here.',
  },
};

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const Page = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = id ?? '';
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<TimelineEntry>>(null);
  const [draft, setDraft] = useState('');

  const {
    access,
    accessError,
    isAccessLoading,
    refetchAccess,
    messages,
    outgoing,
    canRead,
    canSend,
    isLoading,
    error,
    refetch,
    loadOlder,
    hasOlder,
    isLoadingOlder,
    isOlderError,
    connection,
    send,
    retry,
    discard,
    markRead,
  } = useOrderChat(orderId);

  useEffect(() => {
    if (canRead) void markRead();
  }, [canRead, markRead, messages.length]);

  const timeline = mergeChatTimeline(messages, outgoing);

  if (isAccessLoading) {
    return (
      <View style={styles.state} testID="chat-access-loading">
        <Stack.Screen options={{ title: 'Messages' }} />
        <ActivityIndicator size="large" color={Colors.secondary} />
      </View>
    );
  }

  if (accessError) {
    return (
      <View style={styles.state}>
        <Stack.Screen options={{ title: 'Messages' }} />
        <Ionicons name="cloud-offline-outline" size={40} color={Colors.muted} />
        <Text style={styles.mutedText}>We could not open this conversation.</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => refetchAccess()}
          accessibilityRole="button"
          testID="chat-access-retry">
          <Text style={styles.primaryButtonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!canRead) {
    const copy = UNAVAILABLE_COPY[access?.reason ?? 'no_access'] ?? UNAVAILABLE_COPY.no_access;
    return (
      <View style={styles.state} testID="chat-unavailable">
        <Stack.Screen options={{ title: 'Messages' }} />
        <Ionicons name="chatbubbles-outline" size={44} color={Colors.muted} />
        <Text style={styles.stateTitle}>{copy.title}</Text>
        <Text style={styles.mutedText}>{copy.body}</Text>
      </View>
    );
  }

  const renderItem = ({ item }: { item: TimelineEntry }) => {
    if (isPending(item)) {
      return (
        <View style={[styles.bubbleRow, styles.bubbleRowMine]}>
          <View style={[styles.bubble, styles.bubbleMine, styles.bubblePending]}>
            <Text style={styles.bubbleTextMine}>{item.body}</Text>
            <View style={styles.pendingRow}>
              {item.state === 'pending' ? (
                <Text style={styles.pendingText} testID={`message-pending-${item.client_message_id}`}>
                  Sending...
                </Text>
              ) : (
                <>
                  <Text style={styles.failedText} testID={`message-failed-${item.client_message_id}`}>
                    Not sent
                  </Text>
                  <TouchableOpacity
                    onPress={() => retry(item.client_message_id)}
                    accessibilityRole="button"
                    testID={`message-retry-${item.client_message_id}`}>
                    <Text style={styles.retryText}>Retry</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => discard(item.client_message_id)}
                    accessibilityRole="button"
                    testID={`message-discard-${item.client_message_id}`}>
                    <Text style={styles.discardText}>Discard</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.bubbleRow, item.is_mine && styles.bubbleRowMine]}>
        <View style={[styles.bubble, item.is_mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          <Text style={item.is_mine ? styles.bubbleTextMine : styles.bubbleText}>{item.body}</Text>
          <Text style={item.is_mine ? styles.timeMine : styles.time}>
            {formatTime(item.created_at)}
          </Text>
        </View>
      </View>
    );
  };

  const renderEmpty = () => {
    if (isLoading) {
      return (
        <View style={styles.state} testID="chat-loading">
          <ActivityIndicator color={Colors.secondary} />
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.state}>
          <Text style={styles.mutedText}>We could not load the messages.</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => refetch()}
            accessibilityRole="button"
            testID="chat-history-retry">
            <Text style={styles.primaryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.state} testID="chat-empty">
        <Ionicons name="chatbubble-ellipses-outline" size={40} color={Colors.muted} />
        <Text style={styles.mutedText}>No messages yet. Say hello.</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}>
      <Stack.Screen options={{ title: access?.counterpart_name ?? 'Messages' }} />

      {connection === 'disconnected' && (
        <View style={styles.connectionBanner} testID="chat-offline-banner">
          <Ionicons name="cloud-offline-outline" size={14} color="#8A6100" />
          <Text style={styles.connectionText}>Reconnecting. Pull to refresh for new messages.</Text>
        </View>
      )}

      <FlatList
        ref={listRef}
        testID="chat-list"
        data={timeline}
        inverted={timeline.length > 0}
        keyExtractor={(item) =>
          isPending(item) ? `pending-${item.client_message_id}` : `message-${item.id}`
        }
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={timeline.length ? styles.listContent : styles.emptyContent}
        keyboardShouldPersistTaps="handled"
        onEndReached={loadOlder}
        onEndReachedThreshold={0.4}
        refreshing={false}
        onRefresh={refetch}
        ListFooterComponent={
          isLoadingOlder ? (
            <View style={styles.olderState} testID="chat-loading-older">
              <ActivityIndicator color={Colors.secondary} />
            </View>
          ) : isOlderError ? (
            <TouchableOpacity
              style={styles.olderState}
              onPress={loadOlder}
              accessibilityRole="button"
              testID="chat-older-retry">
              <Text style={styles.retryText}>Load earlier messages</Text>
            </TouchableOpacity>
          ) : hasOlder ? (
            <View style={styles.olderState}>
              <Text style={styles.mutedText}>Pull up for earlier messages</Text>
            </View>
          ) : null
        }
      />

      {canSend ? (
        <View style={[styles.composer, { paddingBottom: insets.bottom || 12 }]}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={(text) => setDraft(text.slice(0, MESSAGE_MAX_LENGTH))}
            placeholder="Write a message"
            placeholderTextColor={Colors.muted}
            multiline
            testID="chat-input"
          />
          <TouchableOpacity
            style={[styles.sendButton, !draft.trim() && styles.sendButtonDisabled]}
            disabled={!draft.trim()}
            onPress={() => {
              send(draft);
              setDraft('');
            }}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            testID="chat-send">
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.closedBar, { paddingBottom: insets.bottom || 12 }]} testID="chat-closed">
          <Text style={styles.mutedText}>
            {access?.reason === 'order_closed'
              ? 'This order is complete. You can still read the conversation.'
              : 'Messaging is not available for this order right now.'}
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: Colors.background,
  },
  stateTitle: { fontSize: 17, fontWeight: '700', color: '#000' },
  mutedText: { fontSize: 14, color: Colors.muted, textAlign: 'center' },
  listContent: { padding: 16, gap: 10 },
  emptyContent: { flexGrow: 1 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  bubbleMine: { backgroundColor: Colors.secondary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: '#fff', borderBottomLeftRadius: 4 },
  bubblePending: { opacity: 0.8 },
  bubbleText: { fontSize: 15, color: '#000' },
  bubbleTextMine: { fontSize: 15, color: '#fff' },
  time: { fontSize: 11, color: Colors.muted, alignSelf: 'flex-end' },
  timeMine: { fontSize: 11, color: 'rgba(255,255,255,0.8)', alignSelf: 'flex-end' },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-end' },
  pendingText: { fontSize: 11, color: 'rgba(255,255,255,0.85)' },
  failedText: { fontSize: 11, color: '#FFD9DD' },
  retryText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  discardText: { fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  olderState: { paddingVertical: 16, alignItems: 'center' },
  primaryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.primary,
  },
  primaryButtonText: { color: '#fff', fontWeight: '600' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.light,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: Colors.background,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
  closedBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.light,
  },
  connectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF3D6',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  connectionText: { flex: 1, fontSize: 12, color: '#8A6100' },
});

export default Page;
