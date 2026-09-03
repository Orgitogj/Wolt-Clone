import { Colors } from '@/constants/theme';
import { useIsAdmin } from '@/hooks/useAdmin';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface AdminScreenProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export const AdminScreen = ({ title, subtitle, children }: AdminScreenProps) => {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const { isAdmin, isLoading } = useIsAdmin();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: top + 8 }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#000" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
        <View style={styles.backButton} />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.secondary} />
        </View>
      ) : isAdmin ? (
        children
      ) : (
        <View style={styles.centered}>
          <Ionicons name="lock-closed-outline" size={52} color={Colors.muted} />
          <Text style={styles.emptyTitle}>Administrators only</Text>
          <Text style={styles.emptyText}>
            This account does not have platform administrator access.
          </Text>
        </View>
      )}
    </View>
  );
};

export const AdminEmpty = ({ icon, title, text }: { icon: string; title: string; text: string }) => (
  <View style={styles.centered}>
    <Ionicons name={icon as never} size={44} color={Colors.muted} />
    <Text style={styles.emptyTitle}>{title}</Text>
    <Text style={styles.emptyText}>{text}</Text>
  </View>
);

export const adminStyles = StyleSheet.create({
  list: { padding: 16, gap: 12, paddingBottom: 48 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 8 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#000' },
  cardMeta: { fontSize: 13, color: Colors.muted },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.muted, letterSpacing: 0.4 },
  chipRow: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  chipActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  chipText: { fontSize: 13, color: '#000', fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  action: { flexGrow: 1, flexBasis: '30%', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  actionPrimary: { backgroundColor: Colors.secondary },
  actionPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  actionGhost: { backgroundColor: '#f4f4f4' },
  actionGhostText: { color: Colors.muted, fontSize: 14, fontWeight: '700' },
  actionDestructive: { backgroundColor: '#fbe9e9' },
  actionDestructiveText: { color: '#c1272d', fontSize: 14, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#000',
    backgroundColor: '#fff',
  },
  label: { fontSize: 13, color: Colors.muted },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e6e6e6',
  },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerText: { flex: 1, alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: '#000' },
  subtitle: { fontSize: 13, color: Colors.muted, marginTop: 2 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
    gap: 6,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#000', marginTop: 10 },
  emptyText: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
});
