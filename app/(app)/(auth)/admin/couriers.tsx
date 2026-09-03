import { AdminEmpty, AdminScreen, adminStyles } from '@/components/admin/AdminScreen';
import { Colors } from '@/constants/theme';
import {
  useAdminCourierDocuments,
  useAdminCouriers,
  useIsAdmin,
  useReviewCourier,
  useReviewCourierDocument,
} from '@/hooks/useAdmin';
import { adminService } from '@/services/adminService';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import type { AdminCourier, VerificationStatus } from '@/types/database';
import { formatMoney } from '@/utils/currency';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const FILTERS: { key: VerificationStatus | 'all'; label: string }[] = [
  { key: 'pending', label: 'Applications' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'all', label: 'All' },
];

const REVIEW_ACTIONS: { status: VerificationStatus; label: string; destructive?: boolean }[] = [
  { status: 'approved', label: 'Approve' },
  { status: 'rejected', label: 'Reject', destructive: true },
  { status: 'suspended', label: 'Suspend', destructive: true },
];

const DOCUMENT_LABELS: Record<string, string> = {
  id_card: 'ID card',
  drivers_license: 'Driving licence',
  insurance: 'Insurance',
  vehicle_registration: 'Vehicle registration',
};

const CourierDocuments = ({ courierId }: { courierId: string }) => {
  const { data: documents, isLoading } = useAdminCourierDocuments(courierId);
  const review = useReviewCourierDocument();

  const openDocument = async (storagePath: string) => {
    try {
      const url = await adminService.signDocumentUrl(storagePath);
      if (url) await Linking.openURL(url);
    } catch (error) {
      Alert.alert(
        'Could not open the document',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  };

  const setStatus = async (documentId: string, status: VerificationStatus) => {
    try {
      await review.mutateAsync({ documentId, status });
    } catch (error) {
      Alert.alert('Could not update', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  if (isLoading) return <ActivityIndicator color={Colors.secondary} style={styles.inlineLoader} />;

  if ((documents ?? []).length === 0) {
    return <Text style={adminStyles.cardMeta}>This courier has not uploaded any document.</Text>;
  }

  return (
    <View style={styles.documents}>
      {(documents ?? []).map((document) => (
        <View key={document.id} style={styles.document}>
          <TouchableOpacity
            style={styles.documentHead}
            onPress={() => openDocument(document.storage_path)}>
            <Ionicons name="document-text-outline" size={18} color={Colors.secondary} />
            <Text style={styles.documentName}>
              {DOCUMENT_LABELS[document.kind] ?? document.kind}
            </Text>
            <Text style={[styles.pill, styles[`pill_${document.status}`]]}>{document.status}</Text>
          </TouchableOpacity>
          <View style={styles.documentActions}>
            <TouchableOpacity
              style={[styles.miniAction, styles.miniPrimary]}
              disabled={review.isPending}
              onPress={() => setStatus(document.id, 'approved')}>
              <Text style={styles.miniPrimaryText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.miniAction, styles.miniGhost]}
              disabled={review.isPending}
              onPress={() => setStatus(document.id, 'rejected')}>
              <Text style={styles.miniGhostText}>Reject</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
};

const Page = () => {
  const { isAdmin } = useIsAdmin();
  const { data: settings } = usePlatformSettings();
  const { data: couriers, isLoading, refetch, isRefetching } = useAdminCouriers(isAdmin);
  const review = useReviewCourier();

  const [filterKey, setFilterKey] = useState<VerificationStatus | 'all'>('pending');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const visible = (couriers ?? []).filter(
    (courier) => filterKey === 'all' || courier.verification_status === filterKey
  );

  const onReview = async (courier: AdminCourier, status: VerificationStatus) => {
    try {
      await review.mutateAsync({
        courierId: courier.id,
        status,
        notes: notes.trim() || null,
      });
      setNotes('');
    } catch (error) {
      Alert.alert(
        'Could not update the courier',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  };

  const renderCourier = ({ item }: { item: AdminCourier }) => {
    const isExpanded = expanded === item.id;

    return (
      <View style={adminStyles.card}>
        <View style={adminStyles.cardHeader}>
          <View style={styles.identity}>
            <Text style={adminStyles.cardTitle}>{item.full_name}</Text>
            <Text style={adminStyles.cardMeta}>{item.email ?? item.phone ?? ''}</Text>
          </View>
          <Text style={[styles.pill, styles[`pill_${item.verification_status}`]]}>
            {item.verification_status}
          </Text>
        </View>

        <View style={styles.row}>
          <Ionicons name="bicycle-outline" size={15} color={Colors.muted} />
          <Text style={adminStyles.cardMeta}>
            {item.vehicle_type.replace('_', ' ')}
            {item.vehicle_plate ? ` • ${item.vehicle_plate}` : ''} • {item.availability}
          </Text>
        </View>

        <View style={styles.row}>
          <Ionicons name="checkmark-done-outline" size={15} color={Colors.muted} />
          <Text style={adminStyles.cardMeta}>
            {item.completed_deliveries} delivered • {formatMoney(item.lifetime_earnings, settings?.currency)} earned
          </Text>
        </View>

        <View style={styles.row}>
          <Ionicons name="folder-open-outline" size={15} color={Colors.muted} />
          <Text style={adminStyles.cardMeta}>
            {item.approved_documents}/{item.document_count} documents approved
          </Text>
        </View>

        {!!item.verification_notes && (
          <Text style={styles.notes}>{item.verification_notes}</Text>
        )}

        <TouchableOpacity
          style={styles.expandRow}
          onPress={() => {
            setExpanded(isExpanded ? null : item.id);
            setNotes('');
          }}>
          <Text style={styles.expandText}>{isExpanded ? 'Hide review' : 'Review'}</Text>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={Colors.secondary}
          />
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.panel}>
            <CourierDocuments courierId={item.id} />
            <TextInput
              style={adminStyles.input}
              placeholder="Note for the courier"
              placeholderTextColor={Colors.muted}
              value={notes}
              onChangeText={setNotes}
            />
            <View style={adminStyles.actions}>
              {REVIEW_ACTIONS.filter((action) => action.status !== item.verification_status).map(
                (action) => (
                  <TouchableOpacity
                    key={action.status}
                    style={[
                      adminStyles.action,
                      action.destructive ? adminStyles.actionDestructive : adminStyles.actionPrimary,
                    ]}
                    disabled={review.isPending}
                    onPress={() => onReview(item, action.status)}>
                    <Text
                      style={
                        action.destructive
                          ? adminStyles.actionDestructiveText
                          : adminStyles.actionPrimaryText
                      }>
                      {action.label}
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <AdminScreen title="Couriers" subtitle={`${visible.length} shown`}>
      <FlatList
        horizontal
        data={FILTERS}
        keyExtractor={(item) => item.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={adminStyles.chipRow}
        style={styles.filterList}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[adminStyles.chip, item.key === filterKey && adminStyles.chipActive]}
            onPress={() => setFilterKey(item.key)}>
            <Text
              style={[adminStyles.chipText, item.key === filterKey && adminStyles.chipTextActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
      />

      {isLoading ? (
        <ActivityIndicator size="large" color={Colors.secondary} style={styles.loader} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          renderItem={renderCourier}
          contentContainerStyle={adminStyles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={Colors.secondary}
            />
          }
          ListEmptyComponent={
            <AdminEmpty
              icon="bicycle-outline"
              title="No courier here"
              text="Nobody matches this status right now."
            />
          }
        />
      )}
    </AdminScreen>
  );
};

const styles = StyleSheet.create({
  filterList: { flexGrow: 0 },
  loader: { marginTop: 32 },
  inlineLoader: { marginVertical: 12 },
  identity: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notes: { fontSize: 13, color: '#8a6d3b', backgroundColor: '#fcf8e3', borderRadius: 8, padding: 8 },
  expandRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 4 },
  expandText: { color: Colors.secondary, fontSize: 14, fontWeight: '600' },
  panel: { gap: 8, marginTop: 4 },
  documents: { gap: 8 },
  document: { backgroundColor: '#f7f7f7', borderRadius: 10, padding: 10, gap: 8 },
  documentHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  documentName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#000' },
  documentActions: { flexDirection: 'row', gap: 8 },
  miniAction: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  miniPrimary: { backgroundColor: Colors.secondary },
  miniPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  miniGhost: { backgroundColor: '#e9e9e9' },
  miniGhostText: { color: Colors.muted, fontSize: 13, fontWeight: '700' },
  pill: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  pill_pending: { backgroundColor: '#fff4e5', color: '#a15c00' },
  pill_approved: { backgroundColor: '#e6f6ec', color: '#1b7f3b' },
  pill_rejected: { backgroundColor: '#fbe9e9', color: '#c1272d' },
  pill_suspended: { backgroundColor: '#eceff1', color: '#455a64' },
});

export default Page;
