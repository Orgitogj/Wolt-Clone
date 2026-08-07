import { Colors } from '@/constants/theme';
import { useFavorites } from '@/hooks/useFavorites';
import type { Restaurant } from '@/types/database';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface RestaurantHeaderProps {
  scrollOffset: SharedValue<number>;
  restaurant?: Restaurant;
  searchQuery: string;
  onSearchChange: (value: string) => void;
}

const SCROLL_THRESHOLD_START = 50;
const SCROLL_THRESHOLD_END = 80;

const RestaurantDetailsHeader = ({
  scrollOffset,
  restaurant,
  searchQuery,
  onSearchChange,
}: RestaurantHeaderProps) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [menuVisible, setMenuVisible] = useState(false);
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorite = restaurant ? isFavorite(restaurant.id) : false;

  const headerStyle = useAnimatedStyle(() => {
    const backgroundOpacity = interpolate(
      scrollOffset.value,
      [SCROLL_THRESHOLD_START, SCROLL_THRESHOLD_END],
      [0, 1],
      Extrapolation.CLAMP
    );

    const shadowOpacity = interpolate(
      scrollOffset.value,
      [SCROLL_THRESHOLD_START, SCROLL_THRESHOLD_END],
      [0, 0.1],
      Extrapolation.CLAMP
    );

    return {
      backgroundColor: `rgba(255,255,255, ${backgroundOpacity})`,
      shadowOpacity,
    };
  });

  const searchBarStyle = useAnimatedStyle(() => {
    const backgroundOpacity = interpolate(
      scrollOffset.value,
      [0, SCROLL_THRESHOLD_START],
      [0.9, 1],
      Extrapolation.CLAMP
    );

    return {
      backgroundColor: `rgba(230, 230, 230, ${backgroundOpacity})`,
    };
  });

  const buttonStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollOffset.value,
      [0, SCROLL_THRESHOLD_END],
      [1, 0],
      Extrapolation.CLAMP
    );

    return {
      opacity,
    };
  });

  const buttonStyle2 = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollOffset.value,
      [SCROLL_THRESHOLD_START * 0.3, SCROLL_THRESHOLD_END],
      [0, 1],
      Extrapolation.CLAMP
    );

    return {
      opacity,
    };
  });

  const showMoreInfo = () => {
    if (!restaurant) return;
    const hours = restaurant.opening_hours;
    const hoursText = hours
      ? Object.entries(hours)
          .map(([day, range]) => `${day.slice(0, 3)}: ${range}`)
          .join('\n')
      : 'Opening hours unavailable';
    Alert.alert(restaurant.name, `${restaurant.address ?? ''}\n\n${hoursText}`);
  };

  const shareVenue = () => {
    if (!restaurant) return;
    Share.share({ message: `Check out ${restaurant.name} on Wolt!` });
  };

  const menuItems = [
    {
      label: 'More info',
      icon: 'information-circle-outline' as const,
      onPress: showMoreInfo,
    },
    {
      label: 'Share venue',
      icon: 'share-outline' as const,
      onPress: shareVenue,
    },
  ];

  return (
    <Animated.View style={[styles.headerContainer, headerStyle, { paddingTop: insets.top }]}>
      <View style={[styles.headerContent]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={25} />
        </TouchableOpacity>

        <Animated.View style={[styles.searchBar, searchBarStyle]}>
          <Ionicons name="search" size={20} color={Colors.muted} />
          <TextInput
            style={{ fontSize: 15, flex: 1 }}
            placeholder="Search menu"
            placeholderTextColor={Colors.muted}
            value={searchQuery}
            onChangeText={onSearchChange}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Animated.View>

        <View style={{ width: 40, height: 40 }} />

        <Animated.View style={[styles.iconButton, buttonStyle]}>
          <TouchableOpacity onPress={() => restaurant && toggleFavorite(restaurant)}>
            <Ionicons name={favorite ? 'heart' : 'heart-outline'} size={24} color={favorite ? '#ff4d4f' : '#000'} />
          </TouchableOpacity>
        </Animated.View>

        <Animated.View style={[styles.iconButton, buttonStyle2]}>
          <TouchableOpacity onPress={() => setMenuVisible(true)}>
            <Ionicons name="ellipsis-horizontal" size={24} />
          </TouchableOpacity>
        </Animated.View>
      </View>

      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setMenuVisible(false)}>
          <View
            style={[
              styles.menuContainer,
              { top: insets.top + 60 },
            ]}>
            {menuItems.map((item, index) => (
              <TouchableOpacity
                key={item.label}
                style={[
                  styles.menuItem,
                  index !== menuItems.length - 1 && styles.menuItemBorder,
                ]}
                onPress={() => {
                  item.onPress();
                  setMenuVisible(false);
                }}>
                <Text style={styles.menuItemText}>{item.label}</Text>
                <Ionicons name={item.icon} size={20} color={Colors.muted} />
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    boxShadow: '0px 4px 2px -2px rgba(0, 0, 0, 0.05)',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 4px 2px -2px rgba(0, 0, 0, 0.1)',
  },
  searchBar: {
    flexDirection: 'row',
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
  },
  iconButton: {
    position: 'absolute',
    top: 12,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 4px 2px -2px rgba(0, 0, 0, 0.1)',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  menuContainer: {
    position: 'absolute',
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    minWidth: 200,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  menuItemText: {
    fontSize: 15,
    color: '#000',
  },
});
export default RestaurantDetailsHeader;
