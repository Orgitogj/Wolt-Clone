import { AdminEmpty, AdminScreen, adminStyles } from '@/components/admin/AdminScreen';
import { Colors } from '@/constants/theme';
import {
  useAdminUsers,
  useIsAdmin,
  useRemoveRestaurantMember,
  useSetRestaurantMember,
  useSetUserRole,
} from '@/hooks/useAdmin';
import { useRestaurants } from '@/hooks/useRestaurants';
import type { AdminUser, RestaurantMemberRole, UserRole } from '@/types/database';
import { formatMoney } from '@/utils/currency';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const ROLES: UserRole[] = ['customer', 'courier', 'admin'];
const MEMBER_ROLES: RestaurantMemberRole[] = ['owner', 'manager', 'staff'];

const Page = () => {
  const { isAdmin } = useIsAdmin();
  const { data: settings } = usePlatformSettings();
  const [search, setSearch] = useState('');
  const { data: users, isLoading, refetch, isRefetching } = useAdminUsers(search, isAdmin);
  const { data: restaurants } = useRestaurants();

  const setRole = useSetUserRole();
  const setMember = useSetRestaurantMember();
  const removeMember = useRemoveRestaurantMember();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [memberRole, setMemberRole] = useState<RestaurantMemberRole>('owner');

  const onSetRole = async (user: AdminUser, role: UserRole) => {
    try {
      await setRole.mutateAsync({ userId: user.id, role });
    } catch (error) {
      Alert.alert(
        'Could not change the role',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  };

  const onLinkRestaurant = async (user: AdminUser, restaurantId: string) => {
    try {
      await setMember.mutateAsync({ restaurantId, userId: user.id, role: memberRole });
    } catch (error) {
      Alert.alert(
        'Could not link the restaurant',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  };

  const onUnlinkRestaurant = async (user: AdminUser, restaurantName: string) => {
    const restaurant = (restaurants ?? []).find((item) => item.name === restaurantName);
    if (!restaurant) return;
    try {
      await removeMember.mutateAsync({ restaurantId: restaurant.id, userId: user.id });
    } catch (error) {
      Alert.alert(
        'Could not unlink the restaurant',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  };

  const renderUser = ({ item }: { item: AdminUser }) => {
    const isExpanded = expanded === item.id;
    const managed = item.managed_restaurants ?? [];

    return (
      <View style={adminStyles.card}>
        <View style={adminStyles.cardHeader}>
          <View style={styles.identity}>
            <Text style={adminStyles.cardTitle}>{item.full_name || 'No name'}</Text>
            <Text style={adminStyles.cardMeta}>{item.email ?? item.phone ?? ''}</Text>
          </View>
          <Text style={[styles.pill, styles[`pill_${item.role}`]]}>{item.role}</Text>
        </View>

        <View style={styles.row}>
          <Ionicons name="receipt-outline" size={15} color={Colors.muted} />
          <Text style={adminStyles.cardMeta}>
            {item.order_count} orders • {formatMoney(item.lifetime_value, settings?.currency)} delivered
          </Text>
        </View>

        {(item.is_courier || managed.length > 0) && (
          <View style={styles.row}>
            <Ionicons name="briefcase-outline" size={15} color={Colors.muted} />
            <Text style={adminStyles.cardMeta}>
              {[item.is_courier ? 'Courier account' : null, ...managed]
                .filter(Boolean)
                .join(' • ')}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.expandRow}
          onPress={() => setExpanded(isExpanded ? null : item.id)}>
          <Text style={styles.expandText}>{isExpanded ? 'Hide access' : 'Manage access'}</Text>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={Colors.secondary}
          />
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.panel}>
            <Text style={adminStyles.label}>Platform role</Text>
            <View style={adminStyles.actions}>
              {ROLES.filter((role) => role !== item.role).map((role) => (
                <TouchableOpacity
                  key={role}
                  style={[adminStyles.action, adminStyles.actionPrimary]}
                  disabled={setRole.isPending}
                  onPress={() => onSetRole(item, role)}>
                  <Text style={adminStyles.actionPrimaryText}>Make {role}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {managed.length > 0 && (
              <>
                <Text style={adminStyles.label}>Manages</Text>
                {managed.map((name) => (
                  <View key={name} style={styles.memberRow}>
                    <Text style={styles.memberName}>{name}</Text>
                    <TouchableOpacity
                      disabled={removeMember.isPending}
                      onPress={() => onUnlinkRestaurant(item, name)}>
                      <Text style={styles.removeText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}

            <Text style={adminStyles.label}>Add restaurant access as</Text>
            <View style={styles.roleRow}>
              {MEMBER_ROLES.map((role) => (
                <TouchableOpacity
                  key={role}
                  style={[adminStyles.chip, role === memberRole && adminStyles.chipActive]}
                  onPress={() => setMemberRole(role)}>
                  <Text
                    style={[
                      adminStyles.chipText,
                      role === memberRole && adminStyles.chipTextActive,
                    ]}>
                    {role}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <ScrollView style={styles.restaurantList} nestedScrollEnabled>
              {(restaurants ?? [])
                .filter((restaurant) => !managed.includes(restaurant.name))
                .map((restaurant) => (
                  <TouchableOpacity
                    key={restaurant.id}
                    style={styles.restaurantRow}
                    disabled={setMember.isPending}
                    onPress={() => onLinkRestaurant(item, restaurant.id)}>
                    <Ionicons name="storefront-outline" size={16} color={Colors.secondary} />
                    <Text style={styles.memberName}>{restaurant.name}</Text>
                    <Ionicons name="add-circle-outline" size={18} color={Colors.secondary} />
                  </TouchableOpacity>
                ))}
            </ScrollView>
          </View>
        )}
      </View>
    );
  };

  return (
    <AdminScreen title="People" subtitle={`${users?.length ?? 0} shown`}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={Colors.muted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Name or email"
          placeholderTextColor={Colors.muted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={Colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={Colors.secondary} style={styles.loader} />
      ) : (
        <FlatList
          data={users ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderUser}
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
              icon="people-outline"
              title="Nobody found"
              text="No account matches that search."
            />
          }
        />
      )}
    </AdminScreen>
  );
};

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginTop: 12,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: '#000' },
  loader: { marginTop: 32 },
  identity: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  expandRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 4 },
  expandText: { color: Colors.secondary, fontSize: 14, fontWeight: '600' },
  panel: { gap: 8, marginTop: 4 },
  roleRow: { flexDirection: 'row', gap: 8 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f7f7f7',
    borderRadius: 10,
    padding: 10,
  },
  memberName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#000' },
  removeText: { color: '#c1272d', fontSize: 13, fontWeight: '700' },
  restaurantList: { maxHeight: 220 },
  restaurantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececec',
  },
  pill: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  pill_customer: { backgroundColor: '#eef2f5', color: '#455a64' },
  pill_courier: { backgroundColor: '#E9F9FF', color: '#0094DD' },
  pill_admin: { backgroundColor: '#f3e8ff', color: '#6b21a8' },
});

export default Page;
