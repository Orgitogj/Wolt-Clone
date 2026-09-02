import { Stack } from 'expo-router';

const Layout = () => (
  <Stack>
    <Stack.Screen name="index" options={{ headerShown: false }} />
  </Stack>
);

export default Layout;
