import { Stack } from 'expo-router';

const Layout = () => (
  <Stack screenOptions={{ headerShown: false }}>
    <Stack.Screen name="index" />
    <Stack.Screen name="orders" />
    <Stack.Screen name="couriers" />
    <Stack.Screen name="users" />
    <Stack.Screen name="settings" />
    <Stack.Screen name="reviews" />
    <Stack.Screen name="promotions" />
    <Stack.Screen name="reconciliations" />
    <Stack.Screen name="support" />
    <Stack.Screen name="support-ticket" />
  </Stack>
);

export default Layout;
