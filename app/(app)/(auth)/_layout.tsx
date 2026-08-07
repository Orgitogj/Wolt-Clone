import { Colors } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { TouchableOpacity } from 'react-native';

const Layout = () => {
  const router = useRouter();
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="(modal)/(restaurant)/[id]"
        options={{
                 headerShown:false,

        }}
      />
      <Stack.Screen
        name="(modal)/map"
        options={{
                 headerShown:false,

        }}
      />
      <Stack.Screen
        name="(modal)/location"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.7],
          title: '',
          headerShadowVisible: false,
          sheetCornerRadius: 16,
          sheetGrabberVisible: true,
          headerRight: () => (
            <TouchableOpacity
              style={{ padding: 4, borderRadius: 20, backgroundColor: Colors.light }}
              onPress={() => router.dismiss()}>
              <Ionicons name="close-sharp" size={28} />
            </TouchableOpacity>
          ),
        }}
      />
      <Stack.Screen
        name="(modal)/filter"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.8],
          title: '',
          headerShadowVisible: false,
          sheetCornerRadius: 16,
          sheetGrabberVisible: true,
          contentStyle: {
            backgroundColor: Colors.background,
          },
          headerRight: () => (
            <TouchableOpacity
              style={{ padding: 4, borderRadius: 20, backgroundColor: Colors.light }}
              onPress={() => router.dismiss()}>
              <Ionicons name="close-sharp" size={28} />
            </TouchableOpacity>
          ),
        }}
      />
      <Stack.Screen
        name="(modal)/(menu)/[id]"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [1],
          title: '',
          headerShadowVisible: false,
          sheetCornerRadius: 16,
          sheetGrabberVisible: true,
          sheetExpandsWhenScrolledToEdge: true,
          headerShown: false,
          contentStyle: {
            backgroundColor: '#fff',
          },
        }}
      />
      <Stack.Screen
        name="order"
        options={{
          headerShown:false,
          
        }}
      />
    </Stack>
  );
};
export default Layout;