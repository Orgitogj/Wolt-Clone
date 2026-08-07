import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const iconDataSets = {
  set1: [
    { emoji: '🍕', color: '#FFE5CC' },
    { emoji: '🍔', color: '#F4D03F' },
    { emoji: '🍟', color: '#F8D7DA' },
    { emoji: '🌮', color: '#D5EDDA' },
    { emoji: '🍗', color: '#FADBD8' },
  ],
  set2: [
    { emoji: '🎮', color: '#D1ECF1' },
    { emoji: '🎧', color: '#E2E3E5' },
    { emoji: '☕', color: '#F4D03F' },
    { emoji: '🍿', color: '#FFE5CC' },
    { emoji: '🥤', color: '#F8D7DA' },
  ],
  set3: [
    { emoji: '🍰', color: '#FADBD8' },
    { emoji: '🍦', color: '#D1ECF1' },
    { emoji: '🍪', color: '#FFE5CC' },
    { emoji: '🎲', color: '#D5EDDA' },
    { emoji: '🕹️', color: '#E2E3E5' },
  ],
};

const ITEM_HEIGHT = 160;
const SCROLL_SPEED = 20;   
const GAP = 10;      

interface SmoothInfiniteScrollProps {
  scrollDirection?: 'up' | 'down';
  iconSet?: 'set1' | 'set2' | 'set3';
}

const SmoothInfiniteScroll = ({
  scrollDirection = 'down',
  iconSet = 'set1',
}: SmoothInfiniteScrollProps) => {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);

  const iconData = iconDataSets[iconSet];
  const items = [...iconData, ...iconData];
  const totalContentHeight = iconData.length * ITEM_HEIGHT;

  const totalWrapHeight = totalContentHeight + iconData.length * GAP;

  useEffect(() => {
    const duration = (totalWrapHeight / SCROLL_SPEED) * 1000;  

    if (scrollDirection === 'down') {
      scrollY.value = 0;
      scrollY.value = withRepeat(
        withTiming(totalWrapHeight, { duration }),
        -1, 
        false
      );
    } else {
      scrollY.value = totalWrapHeight;
      scrollY.value = withRepeat(
        withTiming(0, { duration }),
        -1, 
        false 
      );
    }
  }, [scrollDirection, totalWrapHeight]);

  useAnimatedReaction(
    () => scrollY.value,
    (y) => {
      if (scrollDirection === 'down') {
        if (y >= totalContentHeight) {
          scrollY.value = 0;
          scrollTo(scrollRef, 0, 0, false);
        } else {
          scrollTo(scrollRef, 0, y, false);
        }
      } else {
        if (y <= 0) {
          scrollY.value = totalContentHeight;
          scrollTo(scrollRef, 0, totalContentHeight, false);
        } else {
          scrollTo(scrollRef, 0, y, false);
        }
      }
    }
  );

  return (
    <Animated.ScrollView
      contentContainerStyle={styles.container}
      ref={scrollRef}
      scrollEnabled={false}
      showsVerticalScrollIndicator={false}>
      {items.map((item, idx) => (
        <View key={idx} style={[styles.iconContainer, { backgroundColor: item.color }]}>
          <Text style={{ fontSize: 40 }}>{item.emoji}</Text>
        </View>
      ))}
    </Animated.ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 10,
    paddingVertical: 20,
  },
  iconContainer: {
    width: 160,
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    marginHorizontal: 5,
    boxShadow: '0px -2px 10px rgba(0, 0, 0, 0.1)',
  },
});
export default SmoothInfiniteScroll;