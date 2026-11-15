// Adds values from .env on top of app.json at build time.
//   EXPO_PUBLIC_MAP_PROVIDER         – "osm" (default) or "google" (read by the JS bundle; no rebuild to switch)
//   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY  – Android Google Maps key (iOS uses Apple Maps, no key)
//   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID – iOS OAuth client for Google Sheets sign-in
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';
// Google's iOS URL scheme is the client ID reversed: com.googleusercontent.apps.<id>
const iosUrlScheme = iosClientId
  ? `com.googleusercontent.apps.${iosClientId.replace(/\.apps\.googleusercontent\.com$/, '')}`
  : undefined;

module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    config: {
      ...(config.android?.config ?? {}),
      googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '' },
    },
  },
  plugins: [
    ...config.plugins,
    iosUrlScheme ? ['@react-native-google-signin/google-signin', { iosUrlScheme }] : '@react-native-google-signin/google-signin',
  ],
});
