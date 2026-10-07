import { Colors } from '@/constants/theme';
import { useOrderTracking } from '@/hooks/useOrderTracking';
import { useSubmitSupportTicket, useSupportEligibility } from '@/hooks/useSupport';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_DESCRIPTION_MAX_LENGTH,
  describeReportBlocker,
  needsReportedItems,
} from '@/services/supportService';
import type { SupportCategory, SupportReportDraftItem } from '@/types/database';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useMemo, useRef, useState } from 'react';
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

const Page = () => {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = id ?? '';

  const { order } = useOrderTracking(orderId);
  const eligibility = useSupportEligibility(orderId);
  const submit = useSubmitSupportTicket(orderId);

  const [category, setCategory] = useState<SupportCategory | null>(null);
  const [description, setDescription] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const requestId = useRef(Crypto.randomUUID());

  const items = order?.order_items ?? [];
  const wantsItems = category ? needsReportedItems(category) : false;

  const selectedItems = useMemo<SupportReportDraftItem[]>(
    () =>
      Object.entries(quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([orderItemId, quantity]) => ({ order_item_id: orderItemId, quantity })),
    [quantities]
  );

  const trimmed = description.trim();
  const canSubmit =
    !!category &&
    trimmed.length > 0 &&
    (!wantsItems || selectedItems.length > 0) &&
    !submit.isPending;

  const step = (orderItemId: string, max: number, delta: number) => {
    setQuantities((current) => {
      const next = Math.min(Math.max((current[orderItemId] ?? 0) + delta, 0), max);
      return { ...current, [orderItemId]: next };
    });
  };

  const onSubmit = async () => {
    if (!canSubmit || !category) return;

    try {
      const ticket = await submit.mutateAsync({
        category,
        description: trimmed,
        items: wantsItems ? selectedItems : [],
        clientTicketId: requestId.current,
      });

      router.replace({ pathname: '/order/support-ticket', params: { id: ticket.id } });
    } catch (error) {
      Alert.alert(
        'We could not send your report',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  };

  if (eligibility.isLoading) {
    return (
      <View style={styles.state} testID="support-eligibility-loading">
        <Stack.Screen options={{ title: 'Report a problem' }} />
        <ActivityIndicator size="large" color={Colors.secondary} />
      </View>
    );
  }

  if (eligibility.error) {
    return (
      <View style={styles.state}>
        <Stack.Screen options={{ title: 'Report a problem' }} />
        <Ionicons name="cloud-offline-outline" size={40} color={Colors.muted} />
        <Text style={styles.mutedText}>We could not check this order.</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => eligibility.refetch()}
          accessibilityRole="button"
          testID="support-eligibility-retry">
          <Text style={styles.primaryButtonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!eligibility.data?.can_report) {
    const openTicketId = eligibility.data?.open_ticket_id;

    return (
      <View style={styles.state} testID="support-report-blocked">
        <Stack.Screen options={{ title: 'Report a problem' }} />
        <Ionicons name="lock-closed-outline" size={40} color={Colors.muted} />
        <Text style={styles.mutedText}>
          {describeReportBlocker(eligibility.data?.reason ?? 'unknown_order')}
        </Text>
        {!!openTicketId && (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() =>
              router.replace({ pathname: '/order/support-ticket', params: { id: openTicketId } })
            }
            accessibilityRole="button"
            testID="support-open-existing">
            <Text style={styles.primaryButtonText}>Open your report</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Report a problem' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{order?.restaurant?.name ?? 'Your order'}</Text>
        <Text style={styles.mutedText}>Tell us what went wrong and we will look into it.</Text>

        <View style={styles.group}>
          {SUPPORT_CATEGORIES.map((option) => {
            const selected = category === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.option, selected && styles.optionSelected]}
                onPress={() => setCategory(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                testID={`support-category-${option.value}`}>
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={selected ? Colors.primary : Colors.muted}
                />
                <View style={styles.optionText}>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                  <Text style={styles.optionHint}>{option.hint}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {wantsItems && (
          <View style={styles.group} testID="support-items">
            <Text style={styles.sectionTitle}>Which items?</Text>
            {items.length === 0 ? (
              <Text style={styles.mutedText}>We could not load the items on this order.</Text>
            ) : (
              items.map((item) => {
                const picked = quantities[item.id] ?? 0;
                return (
                  <View key={item.id} style={styles.itemRow}>
                    <View style={styles.optionText}>
                      <Text style={styles.optionLabel}>{item.dish_name}</Text>
                      <Text style={styles.optionHint}>Ordered {item.quantity}</Text>
                    </View>
                    <View style={styles.stepper}>
                      <TouchableOpacity
                        style={styles.stepperButton}
                        onPress={() => step(item.id, item.quantity, -1)}
                        disabled={picked === 0}
                        accessibilityRole="button"
                        accessibilityLabel={`Report one fewer ${item.dish_name}`}
                        testID={`support-item-minus-${item.id}`}>
                        <Ionicons
                          name="remove"
                          size={18}
                          color={picked === 0 ? Colors.muted : '#000'}
                        />
                      </TouchableOpacity>
                      <Text style={styles.stepperValue} testID={`support-item-count-${item.id}`}>
                        {picked}
                      </Text>
                      <TouchableOpacity
                        style={styles.stepperButton}
                        onPress={() => step(item.id, item.quantity, 1)}
                        disabled={picked >= item.quantity}
                        accessibilityRole="button"
                        accessibilityLabel={`Report one more ${item.dish_name}`}
                        testID={`support-item-plus-${item.id}`}>
                        <Ionicons
                          name="add"
                          size={18}
                          color={picked >= item.quantity ? Colors.muted : '#000'}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        <TextInput
          style={styles.input}
          value={description}
          onChangeText={(text) => setDescription(text.slice(0, SUPPORT_DESCRIPTION_MAX_LENGTH))}
          placeholder="What happened?"
          placeholderTextColor={Colors.muted}
          multiline
          editable={!submit.isPending}
          testID="support-description-input"
        />
        <Text style={styles.counter}>
          {description.length}/{SUPPORT_DESCRIPTION_MAX_LENGTH}
        </Text>

        <TouchableOpacity
          style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]}
          onPress={onSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit }}
          testID="support-submit">
          {submit.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Send report</Text>
          )}
        </TouchableOpacity>
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
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#000' },
  mutedText: { fontSize: 14, color: Colors.muted, textAlign: 'center' },
  group: { gap: 8, backgroundColor: '#fff', borderRadius: 12, padding: 12 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  optionSelected: { opacity: 1 },
  optionText: { flex: 1, gap: 2 },
  optionLabel: { fontSize: 15, fontWeight: '600', color: '#000' },
  optionHint: { fontSize: 13, color: Colors.muted },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light,
  },
  stepperValue: { minWidth: 20, textAlign: 'center', fontSize: 15, fontWeight: '700' },
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
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

export default Page;
