// AdMob identifiers.
//
// ⚠️ THESE ARE GOOGLE'S OFFICIAL TEST IDS — they always serve "Test Ad"
// creatives and never earn money. When you create a real AdMob account,
// replace them in TWO places:
//   1. app.json → the "react-native-google-mobile-ads" plugin's
//      androidAppId / iosAppId (the ~ "app" ids), then make a NEW dev build
//      (`eas build --profile development`) — app ids are baked in natively.
//   2. This file → the / "banner unit" ids below (a plain JS change, no
//      rebuild needed beyond an OTA/JS reload).
//
// Test ids source: https://developers.google.com/admob/android/test-ads and
// https://developers.google.com/admob/ios/test-ads

import { Platform } from 'react-native';

// App ids (also duplicated in app.json for the native config plugin):
// android ca-app-pub-3940256099942544~3347511713
// ios     ca-app-pub-3940256099942544~1458002511

// Banner ad-unit ids (Google's official test banner units).
export const BANNER_AD_UNIT_ID = Platform.select({
  ios: 'ca-app-pub-3940256099942544/2934735716',
  default: 'ca-app-pub-3940256099942544/6300978111', // android
});
