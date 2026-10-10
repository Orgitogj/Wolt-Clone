import { Colors } from '@/constants/theme';
import type { CheckoutSchedule } from '@/hooks/useCheckout';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export interface ScheduleSectionProps {
  schedule: CheckoutSchedule;
}

export const ScheduleSection = ({ schedule }: ScheduleSectionProps) => (
  <View style={styles.section}>
    <Text style={styles.sectionHeader}>When?</Text>

    {schedule.hasSelection && schedule.choice === 'schedule' && (
      <View style={styles.scheduleSummary}>
        <Ionicons name="time-outline" size={16} color={Colors.secondary} />
        <Text style={styles.scheduleSummaryText}>{schedule.label}</Text>
      </View>
    )}

    <TouchableOpacity
      style={[styles.radioRow, schedule.choice === 'standard' && styles.radioRowActive]}
      onPress={schedule.chooseStandard}>
      <View style={styles.radioLeft}>
        <View style={styles.radioCircle}>
          {schedule.choice === 'standard' && <View style={styles.radioSelected} />}
        </View>
        <View>
          <Text style={styles.radioLabel}>Standard</Text>
          <Text style={styles.radioSubtext}>As soon as possible</Text>
        </View>
      </View>
    </TouchableOpacity>

    <TouchableOpacity
      style={[styles.radioRow, schedule.choice === 'schedule' && styles.radioRowActive]}
      onPress={schedule.chooseSchedule}>
      <View style={styles.radioLeft}>
        <View style={styles.radioCircle}>
          {schedule.choice === 'schedule' && <View style={styles.radioSelected} />}
        </View>
        <View>
          <Text style={styles.radioLabel}>Schedule</Text>
          <Text style={styles.radioSubtext}>Choose a delivery time</Text>
        </View>
      </View>
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  section: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  sectionHeader: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    marginBottom: 16,
  },
  scheduleSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#f1f8fe',
    borderRadius: 10,
  },
  scheduleSummaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.secondary,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  radioRowActive: {
    opacity: 1,
  },
  radioLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  radioCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.secondary,
  },
  radioLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  radioSubtext: {
    fontSize: 14,
    color: '#666',
  },
});
