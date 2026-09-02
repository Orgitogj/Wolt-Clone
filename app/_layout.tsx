import { usePushRegistration } from '@/hooks/useNotifications';
import { StripeProvider } from '@stripe/stripe-react-native';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Slot } from 'expo-router';
import {useFonts} from 'expo-font'
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {Nunito_400Regular,Nunito_700Bold,Nunito_900Black} from '@expo-google-fonts/nunito';
import * as Sentry from '@sentry/react-native';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: !!SENTRY_DSN && !__DEV__,
  sendDefaultPii: false,
  enableLogs: true,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0.1,
  integrations: [
    Sentry.mobileReplayIntegration({
      maskAllText: true,
      maskAllImages: true,
      maskAllVectors: true,
    }),
  ],
});
const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;

const AppShell = () => {
  usePushRegistration();

  if (!STRIPE_PUBLISHABLE_KEY) {
    return <Slot />;
  }

  return (
    <StripeProvider
      publishableKey={STRIPE_PUBLISHABLE_KEY}
      merchantIdentifier="merchant.com.orgito.WOLT"
      urlScheme="wolt">
      <Slot />
    </StripeProvider>
  );
};

const queryClient=new QueryClient(
  {
    defaultOptions:{
      queries:{
        staleTime:1000*60*5,
        retry:1,
      },
    },
  },
);
export default Sentry.wrap(function RootLayout() {

  let [fontsLoaded]=useFonts({
    Nunito_400Regular,
    Nunito_700Bold,
    Nunito_900Black,

  });

  if (!fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <AppShell />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
});
