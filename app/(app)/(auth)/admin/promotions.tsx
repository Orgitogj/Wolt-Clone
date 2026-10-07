import {
  PromotionForm,
  buildPromotionDraft,
  emptyPromotionForm,
  formFromPromotion,
  type PromotionFormState,
} from '@/components/promotions/PromotionForm';
import { Colors } from '@/constants/theme';
import { useAdminPromotions, useSavePromotion, useSetPromotionActive } from '@/hooks/usePromotions';
import type { AdminPromotion } from '@/types/database';
import { formatUtcPreview } from '@/utils/datetime';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const Page = () => {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const { data, isLoading, error, refetch, isRefetching } = useAdminPromotions();
  const savePromotion = useSavePromotion();
  const setActive = useSetPromotionActive();

  const [form, setForm] = useState<PromotionFormState>(emptyPromotionForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const resetForm = () => {
    setForm(emptyPromotionForm);
    setEditingId(null);
    setIsFormOpen(false);
    setFormError(null);
  };

  const startEditing = (promotion: AdminPromotion) => {
    setEditingId(promotion.id);
    setForm(formFromPromotion(promotion));
    setFormError(null);
    setIsFormOpen(true);
  };

  const onSave = async () => {
    if (savePromotion.isPending) return;

    const { draft, error: validationError } = buildPromotionDraft(form, editingId);
    if (!draft) {
      setFormError(validationError);
      return;
    }

    setFormError(null);

    try {
      await savePromotion.mutateAsync(draft);
      resetForm();
    } catch (saveError) {
      setFormError(
        saveError instanceof Error ? saveError.message : 'We could not save this promotion.'
      );
    }
  };

  const onToggleActive = async (promotion: AdminPromotion) => {
    try {
      await setActive.mutateAsync({ id: promotion.id, isActive: !promotion.is_active });
    } catch (toggleError) {
      Alert.alert(
        'We could not update this promotion',
        toggleError instanceof Error ? toggleError.message : 'Please try again.'
      );
    }
  };

  const renderItem = ({ item }: { item: AdminPromotion }) => (
    <View style={styles.card} testID={`promotion-${item.code}`}>
      <View style={styles.cardHeader}>
        <Text style={styles.code}>{item.code}</Text>
        <Switch
          value={item.is_active}
          onValueChange={() => onToggleActive(item)}
          disabled={setActive.isPending}
          trackColor={{ false: Colors.light, true: Colors.primary }}
          thumbColor="#fff"
        />
      </View>

      <Text style={styles.headline}>
        {item.discount_type === 'percentage'
          ? `${Number(item.discount_value)}% off`
          : `${Number(item.discount_value).toFixed(2)} € off`}
        {item.max_discount ? ` (max ${Number(item.max_discount).toFixed(2)} €)` : ''}
      </Text>

      {!!item.description && <Text style={styles.description}>{item.description}</Text>}

      <Text style={styles.meta}>
        Min basket {Number(item.min_subtotal).toFixed(2)} € · {item.redeemed_count}
        {item.max_redemptions ? `/${item.max_redemptions}` : ''} redeemed · {item.max_per_customer}{' '}
        per customer
      </Text>

      {!!item.restaurant_name && (
        <Text style={styles.meta}>Only at {item.restaurant_name}</Text>
      )}

      {(!!item.starts_at || !!item.ends_at) && (
        <Text style={styles.meta}>
          {formatUtcPreview(item.starts_at)} → {formatUtcPreview(item.ends_at)}
        </Text>
      )}

      <TouchableOpacity
        onPress={() => startEditing(item)}
        accessibilityRole="button"
        testID={`edit-promotion-${item.code}`}>
        <Text style={styles.editAction}>Edit</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: top }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>Promotions</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => (isFormOpen ? resetForm() : setIsFormOpen(true))}
          accessibilityRole="button"
          accessibilityLabel={isFormOpen ? 'Close form' : 'New promotion'}
          testID="toggle-promotion-form">
          <Ionicons name={isFormOpen ? 'close' : 'add'} size={24} color={Colors.secondary} />
        </TouchableOpacity>
      </View>

      {isFormOpen && (
        <PromotionForm
          form={form}
          onChange={setForm}
          onSubmit={onSave}
          onCancel={resetForm}
          isSaving={savePromotion.isPending}
          error={formError}
          isEditing={!!editingId}
        />
      )}

      {isLoading ? (
        <View style={styles.state} testID="promotions-loading">
          <ActivityIndicator size="large" color={Colors.secondary} />
        </View>
      ) : error ? (
        <View style={styles.state}>
          <Text style={styles.mutedText}>We could not load promotions.</Text>
          <TouchableOpacity
            style={styles.saveButton}
            onPress={() => refetch()}
            accessibilityRole="button">
            <Text style={styles.saveButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (data ?? []).length === 0 ? (
        <View style={styles.state}>
          <Ionicons name="pricetags-outline" size={40} color={Colors.muted} />
          <Text style={styles.mutedText}>No promotions yet.</Text>
        </View>
      ) : (
        <FlatList
          testID="promotions-list"
          data={data}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshing={isRefetching}
          onRefresh={refetch}
          showsVerticalScrollIndicator={false}
        />
      )}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#000' },
  form: { padding: 16, gap: 10, backgroundColor: '#fff' },
  input: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  inputRow: { flexDirection: 'row', gap: 10 },
  inputHalf: { flex: 1 },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: Colors.primaryLight,
  },
  typeChipActive: { backgroundColor: Colors.primary },
  typeChipText: { fontSize: 13, color: Colors.secondary },
  typeChipTextActive: { color: '#fff', fontWeight: '700' },
  saveButton: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveButtonText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.5 },
  listContent: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  code: { fontSize: 16, fontWeight: '800', color: Colors.secondary, letterSpacing: 0.5 },
  headline: { fontSize: 15, fontWeight: '700', color: '#000' },
  description: { fontSize: 13, color: '#333' },
  meta: { fontSize: 12, color: Colors.muted },
  editAction: { fontSize: 13, fontWeight: '700', color: Colors.secondary, marginTop: 4 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  mutedText: { fontSize: 14, color: Colors.muted, textAlign: 'center' },
});

export default Page;
