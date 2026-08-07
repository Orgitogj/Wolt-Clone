import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Slot, Stack } from 'expo-router';
import {useFonts} from 'expo-font'
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {Nunito_400Regular,Nunito_700Bold,Nunito_900Black} from '@expo-google-fonts/nunito';
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'https://8450922dcee65fdb7b202daad8ff852a@o4511779698311168.ingest.de.sentry.io/4511779718627408',
  sendDefaultPii: true,
  enableLogs: true,
  replaysSessionSampleRate: 1,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration()],

});
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
    <GestureHandlerRootView style={{flex:1}}>
      <QueryClientProvider client={queryClient}>  
        <Slot/>
      </QueryClientProvider>
    
    </GestureHandlerRootView>
  )
});