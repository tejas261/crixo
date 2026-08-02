// Root layout — fonts, stack navigator, global toast host, analytics.

import { useEffect } from 'react';
import { Stack, usePathname } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import ToastHost from '../src/components/Toast';
import { track, trackAppOpen } from '../src/analytics';
import { colors } from '../src/theme';

// Match ids collapse out of screen paths so they aggregate ('/m/:id');
// the raw id rides in props for per-match viewer counts. Mirrors web.
const ID_ROUTES = /^\/(m|umpire|summary|toss)\/([^/]+)/;

// First-party screen views + one app_open per cold start (v16 analytics).
function AnalyticsTracker() {
  const pathname = usePathname();
  useEffect(() => { trackAppOpen(); }, []);
  useEffect(() => {
    if (!pathname) return;
    const m = ID_ROUTES.exec(pathname);
    track('screen', m ? { matchId: m[2] } : undefined, m ? `/${m[1]}/:id` : pathname);
  }, [pathname]);
  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.apricotDeep} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AnalyticsTracker />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
      <ToastHost />
    </SafeAreaProvider>
  );
}
