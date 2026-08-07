import { Colors } from '@/constants/theme';
import { useScheduleStore } from '@/hooks/use-schedule-store';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const Page = () => {
  const router = useRouter();
  const { setSelectedSchedule } = useScheduleStore();
  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedTime, setSelectedTime] = useState(0);

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const in2Days = new Date(today);
  in2Days.setDate(in2Days.getDate() + 2);
  const in3Days = new Date(today);
  in3Days.setDate(in3Days.getDate() + 3);

  const nextDays = [
    'Today',
    `${tomorrow.getDate()}.${tomorrow.getMonth() + 1}`,
    `${in2Days.getDate()}.${in2Days.getMonth() + 1}`,
    `${in3Days.getDate()}.${in3Days.getMonth() + 1}`,
  ];

  const nextTimes = useMemo(() => {
    const slots: string[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      for (let minute = 0; minute < 60; minute += 30) {
        const label = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        slots.push(label);
      }
    }
    return slots;
  }, []);

  const handleConfirm = () => {
    const dayLabel = nextDays[selectedDay];
    const timeLabel = nextTimes[selectedTime];
    setSelectedSchedule({ day: dayLabel, time: timeLabel });
    router.dismiss();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Choose delivery time</Text>
      <Text style={styles.subtitle}>Select the day and time that works best for you.</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Day</Text>
        <View style={styles.optionGrid}>
          {nextDays.map((day, index) => (
            <TouchableOpacity
              key={day}
              style={[styles.optionChip, selectedDay === index && styles.optionChipSelected]}
              onPress={() => setSelectedDay(index)}>
              <Text style={[styles.optionText, selectedDay === index && styles.optionTextSelected]}>
                {day}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Time</Text>
        <ScrollView style={styles.timeList} showsVerticalScrollIndicator={false}>
          {nextTimes.map((time, index) => (
            <TouchableOpacity
              key={time}
              style={[styles.timeOption, selectedTime === index && styles.timeOptionSelected]}
              onPress={() => setSelectedTime(index)}>
              <Text style={[styles.timeText, selectedTime === index && styles.timeTextSelected]}>
                {time}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <TouchableOpacity style={styles.button} onPress={handleConfirm}>
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
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgb(255, 255, 255)',
  },
});