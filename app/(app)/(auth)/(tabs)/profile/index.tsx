import { Colors } from '@/constants/theme';
import useAuthStore from '@/hooks/use-auth-store';
import { useFavorites } from '@/hooks/useFavorites';
import { useCourierProfile } from '@/hooks/useCourier';
import { useNotifications } from '@/hooks/useNotifications';
import { useManagedRestaurants } from '@/hooks/useMerchant';
import { useOrderHistory } from '@/hooks/useOrderHistory';
import { useProfile } from '@/hooks/useProfile';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    Linking,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

const Page = () => {
  const router = useRouter();
  const { signOut, user, isAnonymous } = useAuthStore();
  const { favorites } = useFavorites();
  const { data: orders } = useOrderHistory();
  const { profile, updateProfile } = useProfile();
  const { restaurants: managedRestaurants, isMerchant } = useManagedRestaurants();
  const { courier, isCourier } = useCourierProfile();
  const { unreadCount } = useNotifications();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  useEffect(() => {
    setFullName(profile?.full_name ?? '');
    setPhone(profile?.phone ?? '');
  }, [profile]);

  const onLogout = () => {
    signOut();
  };

  const onInviteFriends = () => {
    Share.share({ message: 'Check out this food delivery app!' });
  };

  const onContactSupport = () => {
    Linking.openURL('mailto:support@example.com?subject=Wolt%20clone%20support');
  };

  const onSaveProfile = async () => {
    await updateProfile({ full_name: fullName.trim(), phone: phone.trim() });
    setIsEditingProfile(false);
  };

  const recentOrders = (orders ?? []).slice(0, 3);
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="automatic">

      <View style={styles.section}>
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={24} color={Colors.secondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuItemTitle}>{profile?.full_name || 'Your profile'}</Text>
            <Text style={styles.menuItemSubtitle}>
              {isAnonymous ? 'Browsing as guest' : user?.email}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.bellButton}
            onPress={() => router.push('/notifications')}>
            <Ionicons name="notifications-outline" size={22} color={Colors.secondary} />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsEditingProfile((v) => !v)}>
            <Ionicons name={isEditingProfile ? 'close' : 'pencil'} size={20} color={Colors.secondary} />
          </TouchableOpacity>
        </View>

        {isEditingProfile && (
          <View style={styles.profileForm}>
            <TextInput
              style={styles.profileInput}
              placeholder="Full name"
              placeholderTextColor={Colors.dark}
              value={fullName}
              onChangeText={setFullName}
            />
            <TextInput
              style={styles.profileInput}
              placeholder="Phone number"
              placeholderTextColor={Colors.dark}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />
            <TouchableOpacity style={styles.saveProfileButton} onPress={onSaveProfile}>
              <Text style={styles.saveProfileButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {profile?.role === 'admin' && (
        <View style={styles.section}>
          <TouchableOpacity style={styles.merchantCard} onPress={() => router.push('/admin')}>
            <View style={styles.merchantIcon}>
              <Ionicons name="shield-checkmark" size={20} color={Colors.secondary} />
            </View>
            <View style={styles.menuItemLeft}>
              <Text style={styles.menuItemTitle}>Admin console</Text>
              <Text style={styles.menuItemSubtitle}>Orders, couriers, people and settings</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>
        </View>
      )}

      {isMerchant && (
        <View style={styles.section}>
          <TouchableOpacity style={styles.merchantCard} onPress={() => router.push('/merchant')}>
            <View style={styles.merchantIcon}>
              <Ionicons name="storefront" size={20} color={Colors.secondary} />
            </View>
            <View style={styles.menuItemLeft}>
              <Text style={styles.menuItemTitle}>Restaurant dashboard</Text>
              <Text style={styles.menuItemSubtitle}>
                {managedRestaurants.length === 1
                  ? managedRestaurants[0].name
                  : `${managedRestaurants.length} restaurants`}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.section}>
        <TouchableOpacity style={styles.merchantCard} onPress={() => router.push('/courier')}>
          <View style={styles.merchantIcon}>
            <Ionicons name="bicycle" size={20} color={Colors.secondary} />
          </View>
          <View style={styles.menuItemLeft}>
            <Text style={styles.menuItemTitle}>
              {isCourier ? 'Courier dashboard' : 'Deliver with us'}
            </Text>
            <Text style={styles.menuItemSubtitle}>
              {isCourier
                ? courier?.verification_status === 'approved'
                  ? 'Go online and take deliveries'
                  : 'Application under review'
                : 'Earn money delivering orders'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#999" />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/order/history')}>
          <View style={styles.menuItemLeft}>
            <Text style={styles.menuItemTitle}>Order history</Text>
            <Text style={styles.menuItemSubtitle}>
              {recentOrders.length > 0
                ? `${recentOrders.length} recent order${recentOrders.length > 1 ? 's' : ''} • Reorder anytime`
                : 'No orders yet • Start your first order'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#999" />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your favorites</Text>
        {favorites.length === 0 ? (
          <View style={styles.favoritesCard}>
            <Text style={styles.favoritesText}>
              Add a restaurant to your favorites by tapping the heart icon in the restaurant view.
            </Text>
            <View style={styles.favoritesIllustration}>
              <View style={styles.storeIcon}>
                <View style={styles.awning} />
                <View style={styles.storeFront} />
                <View style={styles.storeBase} />
              </View>
              <View style={styles.heartIcon}>
                <Ionicons name="heart" size={24} color="#FF3B30" />
              </View>
            </View>
          </View>
        ) : (
          favorites.map((restaurant) => (
            <TouchableOpacity
              key={restaurant.id}
              style={styles.favoriteItem}
              onPress={() => router.push(`/(modal)/(restaurant)/${restaurant.id}`)}>
              <View style={styles.favoriteRow}>
                <View style={styles.favoriteTextContainer}>
                  <Text style={styles.favoriteName}>{restaurant.name}</Text>
                  <Text style={styles.favoriteMeta}>{restaurant.cuisines.join(' • ')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#999" />
              </View>
            </TouchableOpacity>
          ))
        )}
      </View>

      {recentOrders.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent orders</Text>
          {recentOrders.map((order) => (
            <View key={order.id} style={styles.orderItem}>
              <View style={styles.orderInfo}>
                <Text style={styles.orderName}>{order.restaurant?.name ?? 'Restaurant'}</Text>
                <Text style={styles.orderMeta}>
                  {order.delivery_mode === 'pickup' ? 'Pickup' : 'Delivery'} •{' '}
                  {new Date(order.created_at).toLocaleDateString()}
                </Text>
              </View>
              <Text style={styles.orderAmount}>{order.total.toFixed(2)} €</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick links</Text>

        <TouchableOpacity style={styles.linkItem} onPress={onInviteFriends}>
          <Text style={styles.linkText}>Invite friends</Text>
          <Ionicons name="chevron-forward" size={20} color="#999" />
        </TouchableOpacity>

        <View style={styles.separator} />

        <TouchableOpacity style={styles.linkItem} onPress={onContactSupport}>
          <Text style={styles.linkText}>Contact Support</Text>
          <Ionicons name="chevron-forward" size={20} color="#999" />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
        <Text style={styles.logoutButtonText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 32,
  },
  section: {
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileForm: {
    gap: 8,
    paddingBottom: 12,
  },
  profileInput: {
    borderWidth: 1,
    borderColor: '#000',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#000',
  },
  saveProfileButton: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.secondary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  saveProfileButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    paddingVertical: 16,
  },
  bellButton: { padding: 4, marginRight: 8 },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#ff4646',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  merchantCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.primaryLight,
    borderRadius: 12,
    padding: 14,
  },
  merchantIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  menuItemLeft: {
    flex: 1,
  },
  menuItemTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  menuItemSubtitle: {
    fontSize: 14,
    color: '#999',
  },
  separator: {
    height: 1,
    backgroundColor: '#F0F0F0',
  },
  favoritesCard: {
    flexDirection: 'row',
    paddingVertical: 20,
    gap: 16,
  },
  favoriteItem: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  favoriteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  favoriteTextContainer: {
    flex: 1,
  },
  favoriteName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
  },
  favoriteMeta: {
    fontSize: 13,
    color: Colors.muted,
    marginTop: 4,
  },
  favoritesText: {
    flex: 1,
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  orderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececec',
  },
  orderInfo: {
    flex: 1,
  },
  orderName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
  },
  orderMeta: {
    fontSize: 13,
    color: Colors.muted,
    marginTop: 4,
  },
  orderAmount: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.secondary,
  },
  favoritesIllustration: {
    width: 80,
    height: 80,
  },
  storeIcon: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  awning: {
    width: 60,
    height: 20,
    backgroundColor: '#4ECDE6',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    position: 'absolute',
    top: 10,
  },
  storeFront: {
    width: 60,
    height: 40,
    backgroundColor: '#F0F0F0',
    position: 'absolute',
    top: 30,
  },
  storeBase: {
    width: 60,
    height: 8,
    backgroundColor: '#E0E0E0',
    position: 'absolute',
    bottom: 12,
  },
  heartIcon: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#fff',
    borderRadius: 16,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 4px 2px -2px rgba(0, 0, 0, 0.1)',
  },
  linkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  linkText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  logoutButton: {
    backgroundColor: '#fbe9e9',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginBottom: 16,
  },
  logoutButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ff4646',
  },
});

export default Page;
