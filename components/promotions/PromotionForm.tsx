import { RestaurantSelector } from '@/components/promotions/RestaurantSelector';
import { Colors } from '@/constants/theme';
import type { PromotionDraft } from '@/services/promotionService';
import type { AdminPromotion, DiscountType } from '@/types/database';
import {
  SCHEDULE_ERROR_MESSAGES,
  deviceTimeZone,
  formatUtcPreview,
  utcIsoToLocalParts,
  validateScheduleWindow,
} from '@/utils/datetime';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

export interface PromotionFormState {
  code: string;
  description: string;
  discountType: DiscountType;
  discountValue: string;
  maxDiscount: string;
  minSubtotal: string;
  maxRedemptions: string;
  maxPerCustomer: string;
  restaurantId: string | null;
  restaurantName: string | null;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  isActive: boolean;
}

export const emptyPromotionForm: PromotionFormState = {
  code: '',
  description: '',
  discountType: 'percentage',
  discountValue: '',
  maxDiscount: '',
  minSubtotal: '',
  maxRedemptions: '',
  maxPerCustomer: '1',
  restaurantId: null,
  restaurantName: null,
  startDate: '',
  startTime: '',
  endDate: '',
  endTime: '',
  isActive: true,
};

export const formFromPromotion = (promotion: AdminPromotion): PromotionFormState => {
  const start = utcIsoToLocalParts(promotion.starts_at);
  const end = utcIsoToLocalParts(promotion.ends_at);

  return {
    code: promotion.code,
    description: promotion.description ?? '',
    discountType: promotion.discount_type,
    discountValue: String(promotion.discount_value),
    maxDiscount: promotion.max_discount != null ? String(promotion.max_discount) : '',
    minSubtotal: String(promotion.min_subtotal ?? 0),
    maxRedemptions: promotion.max_redemptions != null ? String(promotion.max_redemptions) : '',
    maxPerCustomer: String(promotion.max_per_customer ?? 1),
    restaurantId: promotion.restaurant_id,
    restaurantName: promotion.restaurant_name,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    isActive: promotion.is_active,
  };
};

const toNumber = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const buildPromotionDraft = (
  form: PromotionFormState,
  editingId: string | null
): { draft: PromotionDraft | null; error: string | null } => {
  if (!form.code.trim()) {
    return { draft: null, error: 'A promo code is required' };
  }

  const value = toNumber(form.discountValue);
  if (value === null || Number.isNaN(value) || value <= 0) {
    return { draft: null, error: 'Enter a discount value greater than zero' };
  }

  if (form.discountType === 'percentage' && value > 100) {
    return { draft: null, error: 'A percentage discount cannot be more than 100' };
  }

  const maxDiscount = toNumber(form.maxDiscount);
  if (maxDiscount !== null && (Number.isNaN(maxDiscount) || maxDiscount <= 0)) {
    return { draft: null, error: 'The maximum discount must be greater than zero' };
  }

  const minSubtotal = toNumber(form.minSubtotal);
  if (minSubtotal !== null && (Number.isNaN(minSubtotal) || minSubtotal < 0)) {
    return { draft: null, error: 'The minimum basket cannot be negative' };
  }

  const maxRedemptions = toNumber(form.maxRedemptions);
  if (
    maxRedemptions !== null &&
    (Number.isNaN(maxRedemptions) || maxRedemptions < 1 || !Number.isInteger(maxRedemptions))
  ) {
    return { draft: null, error: 'Total uses must be a whole number of at least one' };
  }

  const maxPerCustomer = toNumber(form.maxPerCustomer);
  if (
    maxPerCustomer === null ||
    Number.isNaN(maxPerCustomer) ||
    maxPerCustomer < 1 ||
    !Number.isInteger(maxPerCustomer)
  ) {
    return { draft: null, error: 'Uses per customer must be a whole number of at least one' };
  }

  const schedule = validateScheduleWindow(
    form.startDate,
    form.startTime,
    form.endDate,
    form.endTime
  );

  if (schedule.error) {
    return { draft: null, error: SCHEDULE_ERROR_MESSAGES[schedule.error] };
  }

  return {
    draft: {
      id: editingId,
      code: form.code.trim(),
      description: form.description.trim() || null,
      discountType: form.discountType,
      discountValue: value,
      maxDiscount: form.discountType === 'percentage' ? maxDiscount : null,
      minSubtotal: minSubtotal ?? 0,
      restaurantId: form.restaurantId,
      startsAt: schedule.window.startsAt,
      endsAt: schedule.window.endsAt,
      maxRedemptions,
      maxPerCustomer,
      isActive: form.isActive,
    },
    error: null,
  };
};

interface PromotionFormProps {
  form: PromotionFormState;
  onChange: (form: PromotionFormState) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSaving: boolean;
  error: string | null;
  isEditing: boolean;
}

export const PromotionForm = ({
  form,
  onChange,
  onSubmit,
  onCancel,
  isSaving,
  error,
  isEditing,
}: PromotionFormProps) => {
  const [showSchedule, setShowSchedule] = useState(
    () => !!form.startDate || !!form.endDate
  );

  const timeZone = useMemo(() => deviceTimeZone(), []);
  const schedule = validateScheduleWindow(
    form.startDate,
    form.startTime,
    form.endDate,
    form.endTime
  );

  const set = (patch: Partial<PromotionFormState>) => onChange({ ...form, ...patch });

  return (
    <View style={styles.form}>
      <TextInput
        style={styles.input}
        value={form.code}
        onChangeText={(text) => set({ code: text.toUpperCase() })}
        placeholder="CODE"
        placeholderTextColor={Colors.muted}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!isSaving}
        testID="promotion-code-input"
      />

      <TextInput
        style={styles.input}
        value={form.description}
        onChangeText={(text) => set({ description: text })}
        placeholder="Description customers see"
        placeholderTextColor={Colors.muted}
        editable={!isSaving}
        testID="promotion-description-input"
      />

      <View style={styles.typeRow}>
        {(['percentage', 'fixed'] as DiscountType[]).map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.typeChip, form.discountType === type && styles.typeChipActive]}
            onPress={() => set({ discountType: type })}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityState={{ selected: form.discountType === type }}
            testID={`promotion-type-${type}`}>
            <Text
              style={[
                styles.typeChipText,
                form.discountType === type && styles.typeChipTextActive,
              ]}>
              {type === 'percentage' ? 'Percentage' : 'Fixed amount'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, styles.inputHalf]}
          value={form.discountValue}
          onChangeText={(text) => set({ discountValue: text })}
          placeholder={form.discountType === 'percentage' ? 'Percent off' : 'Amount off'}
          placeholderTextColor={Colors.muted}
          keyboardType="decimal-pad"
          editable={!isSaving}
          testID="promotion-value-input"
        />
        {form.discountType === 'percentage' && (
          <TextInput
            style={[styles.input, styles.inputHalf]}
            value={form.maxDiscount}
            onChangeText={(text) => set({ maxDiscount: text })}
            placeholder="Max discount"
            placeholderTextColor={Colors.muted}
            keyboardType="decimal-pad"
            editable={!isSaving}
            testID="promotion-max-discount-input"
          />
        )}
      </View>

      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, styles.inputHalf]}
          value={form.minSubtotal}
          onChangeText={(text) => set({ minSubtotal: text })}
          placeholder="Min basket"
          placeholderTextColor={Colors.muted}
          keyboardType="decimal-pad"
          editable={!isSaving}
          testID="promotion-min-subtotal-input"
        />
        <TextInput
          style={[styles.input, styles.inputHalf]}
          value={form.maxRedemptions}
          onChangeText={(text) => set({ maxRedemptions: text })}
          placeholder="Total uses"
          placeholderTextColor={Colors.muted}
          keyboardType="number-pad"
          editable={!isSaving}
          testID="promotion-max-redemptions-input"
        />
      </View>

      <TextInput
        style={styles.input}
        value={form.maxPerCustomer}
        onChangeText={(text) => set({ maxPerCustomer: text })}
        placeholder="Uses per customer"
        placeholderTextColor={Colors.muted}
        keyboardType="number-pad"
        editable={!isSaving}
        testID="promotion-max-per-customer-input"
      />

      <RestaurantSelector
        selectedId={form.restaurantId}
        selectedName={form.restaurantName}
        onSelect={(restaurant) =>
          set({
            restaurantId: restaurant?.id ?? null,
            restaurantName: restaurant?.name ?? null,
          })
        }
      />

      <TouchableOpacity
        style={styles.scheduleToggle}
        onPress={() => setShowSchedule((open) => !open)}
        accessibilityRole="button"
        testID="promotion-schedule-toggle">
        <Ionicons name="calendar-outline" size={16} color={Colors.secondary} />
        <Text style={styles.scheduleToggleText}>
          {showSchedule ? 'Hide schedule' : 'Add a schedule'}
        </Text>
      </TouchableOpacity>

      {showSchedule && (
        <View style={styles.scheduleBlock}>
          <Text style={styles.timezoneText}>
            Times are entered in {timeZone} and stored as UTC
          </Text>

          <Text style={styles.fieldLabel}>Starts</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, styles.inputHalf]}
              value={form.startDate}
              onChangeText={(text) => set({ startDate: text })}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.muted}
              autoCapitalize="none"
              editable={!isSaving}
              testID="promotion-start-date"
            />
            <TextInput
              style={[styles.input, styles.inputHalf]}
              value={form.startTime}
              onChangeText={(text) => set({ startTime: text })}
              placeholder="HH:MM"
              placeholderTextColor={Colors.muted}
              editable={!isSaving}
              testID="promotion-start-time"
            />
          </View>

          <Text style={styles.fieldLabel}>Ends</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, styles.inputHalf]}
              value={form.endDate}
              onChangeText={(text) => set({ endDate: text })}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.muted}
              autoCapitalize="none"
              editable={!isSaving}
              testID="promotion-end-date"
            />
            <TextInput
              style={[styles.input, styles.inputHalf]}
              value={form.endTime}
              onChangeText={(text) => set({ endTime: text })}
              placeholder="HH:MM"
              placeholderTextColor={Colors.muted}
              editable={!isSaving}
              testID="promotion-end-time"
            />
          </View>

          {schedule.error ? (
            <Text style={styles.inlineError} testID="promotion-schedule-error">
              {SCHEDULE_ERROR_MESSAGES[schedule.error]}
            </Text>
          ) : (
            <Text style={styles.previewText} testID="promotion-schedule-preview">
              {formatUtcPreview(schedule.window.startsAt)} →{' '}
              {formatUtcPreview(schedule.window.endsAt)}
            </Text>
          )}
        </View>
      )}

      <View style={styles.activeRow}>
        <Text style={styles.fieldLabel}>Active</Text>
        <Switch
          value={form.isActive}
          onValueChange={(isActive) => set({ isActive })}
          disabled={isSaving}
          trackColor={{ false: Colors.light, true: Colors.primary }}
          thumbColor="#fff"
          testID="promotion-active-switch"
        />
      </View>

      {!!error && (
        <Text style={styles.formError} testID="promotion-form-error">
          {error}
        </Text>
      )}

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={onCancel}
          disabled={isSaving}
          accessibilityRole="button"
          testID="promotion-cancel">
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveButton, isSaving && styles.disabled]}
          onPress={onSubmit}
          disabled={isSaving}
          accessibilityRole="button"
          accessibilityState={{ disabled: isSaving }}
          testID="save-promotion">
          {isSaving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>{isEditing ? 'Save changes' : 'Create'}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
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
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  scheduleToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  scheduleToggleText: { fontSize: 14, fontWeight: '700', color: Colors.secondary },
  scheduleBlock: {
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: Colors.background,
  },
  timezoneText: { fontSize: 12, color: Colors.muted },
  previewText: { fontSize: 12, color: Colors.secondary },
  inlineError: { fontSize: 12, color: '#B32433' },
  activeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  formError: { fontSize: 13, color: '#B32433' },
  actions: { flexDirection: 'row', gap: 10 },
  cancelButton: {
    flex: 1,
    backgroundColor: Colors.primaryLight,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelButtonText: { color: Colors.secondary, fontWeight: '700' },
  saveButton: {
    flex: 2,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveButtonText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
