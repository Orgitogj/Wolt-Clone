import { Ionicons } from '@expo/vector-icons';
import { useRouter,Stack } from 'expo-router';
import { StyleSheet, TouchableOpacity } from 'react-native';
const Layout = () => {
  const router = useRouter();

  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          headerShown: false,
          contentStyle: {
          },
        }}
      />
      <Stack.Screen
        name="history"
        options={{
          title: 'Order history',
          headerShown: false,
          contentStyle: {
            backgroundColor: '#fff',
          },
        }}
      />
      <Stack.Screen
        name="track"
        options={{
          headerShown: false,
          contentStyle: {
            backgroundColor: '#fff',
          },
        }}
      />
      <Stack.Screen
        name="checkout"
        options={{
          title: '',
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: {
            backgroundColor: '#fff',
          },
        }}
      />
      <Stack.Screen
        name="chat"
        options={{
          title: 'Messages',
          contentStyle: {
            backgroundColor: '#fff',
          },
        }}
      />
      <Stack.Screen
        name="reorder"
        options={{
          title: 'Order again',
          contentStyle: {
            backgroundColor: '#fff',
          },
        }}
      />
      <Stack.Screen
        name="review"
        options={{
          title: 'Rate your order',
          contentStyle: {
            backgroundColor: '#fff',
          },
        }}
      />
      <Stack.Screen
        name="support"
        options={{
          title: 'Report a problem',
          contentStyle: {
            backgroundColor: '#fff',
          },
        }}
      />
      <Stack.Screen
        name="support-tickets"
        options={{
          title: 'Your reports',
          contentStyle: {
            backgroundColor: '#fff',
          },
        }}
      />
      <Stack.Screen
        name="support-ticket"
        options={{
          title: 'Your report',
          contentStyle: {
            backgroundColor: '#fff',
          },
        }}
      />
      <Stack.Screen
        name="schedule"
        options={{
          title: 'Schedule delivery',
          presentation: 'formSheet',
          sheetCornerRadius: 24,
          sheetGrabberVisible: true,
          sheetAllowedDetents: [0.5],
          contentStyle: {
            backgroundColor: '#fff',
          },
          headerRight: () => (
            <TouchableOpacity style={styles.closeButton} onPress={() => router.dismiss()}>
              <Ionicons name="close" size={28} color={'#000'} />
            </TouchableOpacity>
          ),
        }}
      />
    </Stack>
  );
};
const styles = StyleSheet.create({
  closeButton: {
    marginLeft: 4,
  },
});
export default Layout;
