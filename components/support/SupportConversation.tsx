import { Colors } from '@/constants/theme';
import { mergeSupportTimeline } from '@/hooks/useSupport';
import { SUPPORT_MESSAGE_MAX_LENGTH } from '@/services/supportService';
import type { OutgoingMessage, SupportMessage } from '@/types/database';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

export interface SupportConversationProps {
  messages: SupportMessage[];
  outgoing: OutgoingMessage[];
  isLoading: boolean;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  isOlderError: boolean;
  canSend: boolean;
  onSend: (body: string) => void;
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
  onLoadOlder: () => void;
}

const isOutgoing = (item: SupportMessage | OutgoingMessage): item is OutgoingMessage =>
  !('id' in item);

export const SupportConversation = ({
  messages,
  outgoing,
  isLoading,
  hasOlder,
  isLoadingOlder,
  isOlderError,
  canSend,
  onSend,
  onRetry,
  onDiscard,
  onLoadOlder,
}: SupportConversationProps) => {
  const [draft, setDraft] = useState('');

  const timeline = useMemo(() => mergeSupportTimeline(messages, outgoing), [messages, outgoing]);

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || !canSend) return;
    onSend(trimmed);
    setDraft('');
  };

  if (isLoading) {
    return (
      <View style={styles.state} testID="support-conversation-loading">
        <ActivityIndicator color={Colors.secondary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        inverted
        data={timeline}
        testID="support-conversation"
        keyExtractor={(item) => ('id' in item ? item.id : item.client_message_id)}
        contentContainerStyle={styles.listContent}
        onEndReachedThreshold={0.4}
        onEndReached={hasOlder && !isLoadingOlder ? onLoadOlder : undefined}
        ListEmptyComponent={
          <Text style={styles.mutedText}>No messages yet. Tell us more if you need to.</Text>
        }
        ListFooterComponent={
          isLoadingOlder ? (
            <ActivityIndicator style={styles.footer} color={Colors.secondary} />
          ) : isOlderError ? (
            <TouchableOpacity
              style={styles.footer}
              onPress={onLoadOlder}
              accessibilityRole="button"
              testID="support-load-older-retry">
              <Text style={styles.linkText}>Could not load older messages. Try again</Text>
            </TouchableOpacity>
          ) : null
        }
        renderItem={({ item }) => {
          if (isOutgoing(item)) {
            const failed = item.state === 'failed';
            return (
              <View style={[styles.bubble, styles.mine]} testID="support-message-outgoing">
                <Text style={styles.mineText}>{item.body}</Text>
                <View style={styles.bubbleMeta}>
                  <Text style={styles.mineMeta}>{failed ? 'Not sent' : 'Sending'}</Text>
                  {failed && (
                    <>
                      <TouchableOpacity
                        onPress={() => onRetry(item.client_message_id)}
                        accessibilityRole="button"
                        testID="support-message-retry">
                        <Text style={styles.mineAction}>Retry</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => onDiscard(item.client_message_id)}
                        accessibilityRole="button"
                        testID="support-message-discard">
                        <Text style={styles.mineAction}>Discard</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            );
          }

          const mine = item.is_mine;
          return (
            <View
              style={[styles.bubble, mine ? styles.mine : styles.theirs]}
              testID={`support-message-${item.id}`}>
              {!mine && (
                <Text style={styles.sender}>
                  {item.sender_role === 'admin' ? 'Support' : 'Customer'}
                </Text>
              )}
              <Text style={mine ? styles.mineText : styles.theirsText}>{item.body}</Text>
              <Text style={mine ? styles.mineMeta : styles.theirsMeta}>
                {new Date(item.created_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          );
        }}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          value={draft}
          onChangeText={(text) => setDraft(text.slice(0, SUPPORT_MESSAGE_MAX_LENGTH))}
          placeholder={canSend ? 'Write a message' : 'This conversation is closed'}
          placeholderTextColor={Colors.muted}
          editable={canSend}
          multiline
          testID="support-composer-input"
        />
        <TouchableOpacity
          style={[styles.sendButton, (!canSend || !draft.trim()) && styles.sendButtonDisabled]}
          onPress={submit}
          disabled={!canSend || !draft.trim()}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend || !draft.trim() }}
          testID="support-composer-send">
          <Ionicons name="send" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  state: { paddingVertical: 24, alignItems: 'center' },
  listContent: { padding: 16, gap: 8 },
  footer: { paddingVertical: 12, alignItems: 'center' },
  mutedText: { fontSize: 14, color: Colors.muted, textAlign: 'center', paddingVertical: 24 },
  linkText: { fontSize: 13, color: Colors.secondary, fontWeight: '600' },
  bubble: { maxWidth: '82%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: Colors.primary },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#fff' },
  sender: { fontSize: 11, fontWeight: '700', color: Colors.muted },
  mineText: { color: '#fff', fontSize: 15 },
  theirsText: { color: '#000', fontSize: 15 },
  mineMeta: { color: 'rgba(255,255,255,0.8)', fontSize: 11 },
  theirsMeta: { color: Colors.muted, fontSize: 11 },
  mineAction: { color: '#fff', fontSize: 11, fontWeight: '700' },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.light,
  },
  composerInput: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: Colors.background,
    fontSize: 15,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
  },
  sendButtonDisabled: { opacity: 0.4 },
});
