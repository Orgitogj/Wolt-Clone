import { Colors } from '@/constants/theme';
import { useScheduleStore } from '@/hooks/use-schedule-store';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const SLOT_MINUTES = 30;
const DAYS_AHEAD = 4;

interface Slot {
  label: string;
  date: Date;
}

const Page = () => {
  const router = useRouter();
  const { setSelectedSchedule } = useScheduleStore();
  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedTime, setSelectedTime] = useState(0);

  const days = useMemo(() => {
    const now = new Date();
    return Array.from({ length: DAYS_AHEAD }, (_, offset) => {
      const date = new Date(now);
      date.setDate(now.getDate() + offset);
      date.setHours(0, 0, 0, 0);
      return {
        label: offset === 0 ? 'Today' : `${date.getDate()}.${date.getMonth() + 1}`,
        date,
      };
    });
  }, []);

  const slots = useMemo<Slot[]>(() => {
    const day = days[selectedDay];
    if (!day) return [];
    const now = Date.now();
    const result: Slot[] = [];
    for (let minutes = 0; minutes < 24 * 60; minutes += SLOT_MINUTES) {
      const date = new Date(day.date);
      date.setMinutes(minutes);
      if (date.getTime() <= now) continue;
      const hours = String(date.getHours()).padStart(2, '0');
      const mins = String(date.getMinutes()).padStart(2, '0');
      result.push({ label: `${hours}:${mins}`, date });
    }
    return result;
  }, [days, selectedDay]);

  useEffect(() => {
    setSelectedTime(0);
  }, [selectedDay]);

  const handleConfirm = () => {
    const day = days[selectedDay];
    const slot = slots[selectedTime];
    if (!day || !slot) return;
    setSelectedSchedule({
      day: day.label,
      time: slot.label,
      isoTimestamp: slot.date.toISOString(),
    });
    router.dismiss();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Choose delivery time</Text>
      <Text style={styles.subtitle}>Select the day and time that works best for you.</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Day</Text>
        <View style={styles.optionGrid}>
          {days.map((day, index) => (
            <TouchableOpacity
              key={day.label}
              style={[styles.optionChip, selectedDay === index && styles.optionChipSelected]}
              onPress={() => setSelectedDay(index)}>
              <Text style={[styles.optionText, selectedDay === index && styles.optionTextSelected]}>
                {day.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Time</Text>
        {slots.length === 0 ? (
          <Text style={styles.subtitle}>No slots left today. Pick another day.</Text>
        ) : (
          <ScrollView style={styles.timeList} showsVerticalScrollIndicator={false}>
            {slots.map((slot, index) => (
              <TouchableOpacity
                key={slot.label}
                style={[styles.timeOption, selectedTime === index && styles.timeOptionSelected]}
                onPress={() => setSelectedTime(index)}>
                <Text style={[styles.timeText, selectedTime === index && styles.timeTextSelected]}>
                  {slot.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      <TouchableOpacity
        style={[styles.button, slots.length === 0 && styles.buttonDisabled]}
        onPress={handleConfirm}
        disabled={slots.length === 0}>
        <Text style={styles.buttonText}>Confirm</Text>
      </TouchableOpacity>
    </View>
  );
};

export default Page;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 10,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  optionChipSelected: {
    backgroundColor: Colors.secondary,
    borderColor: Colors.secondary,
  },
  optionText: {
    fontSize: 14,
    color: '#000',
  },
  optionTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  timeList: {
    maxHeight: 220,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 8,
  },
  timeOption: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  timeOptionSelected: {
    backgroundColor: Colors.light,
  },
  timeText: {
    fontSize: 14,
    color: '#000',
  },
  timeTextSelected: {
    color: Colors.secondary,
    fontWeight: '700',
  },
  button: {
    marginTop: 20,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.secondary,
    boxShadow: '0px 4px 12px rgba(0, 157, 224, 0.3)',
  },
  buttonDisabled: {
    backgroundColor: '#e0e0e0',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgb(255, 255, 255)',
  },
});
