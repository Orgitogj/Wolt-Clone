import { Stack } from 'expo-router';

const Layout = () => (
  <Stack screenOptions={{ headerShown: false }}>
    <Stack.Screen name="index" />
    <Stack.Screen name="orders" />
    <Stack.Screen name="couriers" />
    <Stack.Screen name="users" />
    <Stack.Screen name="settings" />
  </Stack>
);

export default Layout;
