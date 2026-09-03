import { AdminScreen, adminStyles } from '@/components/admin/AdminScreen';
import { Colors } from '@/constants/theme';
import { useUpdatePlatformSettings } from '@/hooks/useAdmin';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import type { PlatformSettings, PlatformSettingsPatch } from '@/types/database';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type NumericKey = Exclude<
  keyof PlatformSettings,
  'id' | 'updated_at' | 'currency' | 'default_timezone' | 'card_payments_enabled'
>;

interface Group {
  title: string;
  fields: { key: NumericKey; label: string }[];
}

const GROUPS: Group[] = [
  {
    title: 'PAYMENTS',
    fields: [
      { key: 'commission_rate', label: 'Commission rate (0 to 1)' },
      { key: 'payment_hold_minutes', label: 'Unpaid order hold (minutes)' },
    ],
  },
  {
    title: 'CUSTOMER FEES',
    fields: [
      { key: 'service_fee', label: 'Service fee' },
      { key: 'delivery_base_fee', label: 'Delivery base fee' },
      { key: 'delivery_base_distance_km', label: 'Base distance (km)' },
      { key: 'delivery_per_km_fee', label: 'Fee per extra km' },
      { key: 'fallback_distance_km', label: 'Fallback distance (km)' },
      { key: 'max_delivery_distance_km', label: 'Max delivery distance (km)' },
      { key: 'max_tip', label: 'Maximum tip' },
    ],
  },
  {
    title: 'ORDERING',
    fields: [
      { key: 'max_item_quantity', label: 'Max quantity per item' },
      { key: 'scheduling_grace_minutes', label: 'Scheduling grace (minutes)' },
      { key: 'max_schedule_days_ahead', label: 'Schedule window (days)' },
    ],
  },
  {
    title: 'DISPATCH',
    fields: [
      { key: 'delivery_offer_timeout_seconds', label: 'Offer timeout (seconds)' },
      { key: 'courier_search_radius_km', label: 'Courier search radius (km)' },
      { key: 'courier_base_fee', label: 'Courier base fee' },
      { key: 'courier_per_km_fee', label: 'Courier fee per km' },
      { key: 'max_delivery_offers', label: 'Max offers per delivery' },
    ],
  },
];

const Page = () => {
  const { data: settings, isLoading } = usePlatformSettings();
  const update = useUpdatePlatformSettings();

  const [values, setValues] = useState<Record<string, string>>({});
  const [currency, setCurrency] = useState('');
  const [timezone, setTimezone] = useState('');
  const [cardPayments, setCardPayments] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const next: Record<string, string> = {};
    GROUPS.forEach((group) =>
      group.fields.forEach((field) => {
        next[field.key] = String(settings[field.key] ?? '');
      })
    );
    setValues(next);
    setCurrency(settings.currency);
    setTimezone(settings.default_timezone);
    setCardPayments(settings.card_payments_enabled);
  }, [settings]);

  const onSave = async () => {
    if (!settings) return;

    const patch: PlatformSettingsPatch = {};

    for (const group of GROUPS) {
      for (const field of group.fields) {
        const raw = (values[field.key] ?? '').replace(',', '.').trim();
        const parsed = Number(raw);
        if (raw === '' || !Number.isFinite(parsed)) {
          Alert.alert('Check the value', `${field.label} must be a number.`);
          return;
        }
        if (parsed !== Number(settings[field.key])) {
          patch[field.key] = parsed;
        }
      }
    }

    if (currency.trim().toUpperCase() !== settings.currency) {
      patch.currency = currency.trim().toUpperCase();
    }
    if (timezone.trim() !== settings.default_timezone) {
      patch.default_timezone = timezone.trim();
    }
    if (cardPayments !== settings.card_payments_enabled) {
      patch.card_payments_enabled = cardPayments;
    }

    if (Object.keys(patch).length === 0) {
      Alert.alert('Nothing to save', 'These settings already match the platform.');
      return;
    }

    try {
      await update.mutateAsync(patch);
      Alert.alert('Saved', 'The platform settings are live.');
    } catch (error) {
      Alert.alert(
        'Could not save',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  };

  return (
    <AdminScreen title="Settings" subtitle="Fees, limits and payments">
      {isLoading || !settings ? (
        <ActivityIndicator size="large" color={Colors.secondary} style={styles.loader} />
      ) : (
        <ScrollView contentContainerStyle={adminStyles.list} keyboardShouldPersistTaps="handled">
          <View style={adminStyles.card}>
            <View style={styles.switchRow}>
              <View style={styles.switchBody}>
                <Text style={adminStyles.cardTitle}>Card payments</Text>
                <Text style={adminStyles.cardMeta}>
                  When this is off customers can only pay with cash.
                </Text>
              </View>
              <Switch
                value={cardPayments}
                onValueChange={setCardPayments}
                trackColor={{ true: Colors.secondary }}
              />
            </View>

            <Text style={adminStyles.label}>Currency</Text>
            <TextInput
              style={adminStyles.input}
              value={currency}
              onChangeText={setCurrency}
              autoCapitalize="characters"
              maxLength={3}
            />

            <Text style={adminStyles.label}>Default timezone</Text>
            <TextInput
              style={adminStyles.input}
              value={timezone}
              onChangeText={setTimezone}
              autoCapitalize="none"
            />
          </View>

          {GROUPS.map((group) => (
            <View key={group.title} style={styles.group}>
              <Text style={adminStyles.sectionTitle}>{group.title}</Text>
              <View style={adminStyles.card}>
                {group.fields.map((field) => (
                  <View key={field.key} style={styles.field}>
                    <Text style={adminStyles.label}>{field.label}</Text>
                    <TextInput
                      style={adminStyles.input}
                      value={values[field.key] ?? ''}
                      onChangeText={(text) =>
                        setValues((current) => ({ ...current, [field.key]: text }))
                      }
                      keyboardType="decimal-pad"
                    />
                  </View>
                ))}
              </View>
            </View>
          ))}

          <TouchableOpacity
            style={[adminStyles.action, adminStyles.actionPrimary, styles.save]}
            disabled={update.isPending}
            onPress={onSave}>
            <Text style={adminStyles.actionPrimaryText}>
              {update.isPending ? 'Saving...' : 'Save settings'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.footnote}>
            Last changed {new Date(settings.updated_at).toLocaleString()}
          </Text>
        </ScrollView>
      )}
    </AdminScreen>
  );
};

const styles = StyleSheet.create({
  loader: { marginTop: 32 },
  group: { gap: 8 },
  field: { gap: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchBody: { flex: 1, gap: 2 },
  save: { marginTop: 8 },
  footnote: { fontSize: 12, color: Colors.muted, textAlign: 'center', marginTop: 4 },
});

export default Page;
