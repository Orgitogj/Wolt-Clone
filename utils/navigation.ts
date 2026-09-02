import { Linking, Platform } from 'react-native';

export const openDirections = async (
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  label?: string
): Promise<boolean> => {
  if (latitude == null || longitude == null) return false;

  const coords = `${latitude},${longitude}`;
  const encodedLabel = encodeURIComponent(label ?? 'Destination');

  const candidates =
    Platform.OS === 'ios'
      ? [
          `maps://?daddr=${coords}&dirflg=d`,
          `http://maps.apple.com/?daddr=${coords}&q=${encodedLabel}`,
        ]
      : [
          `google.navigation:q=${coords}`,
          `geo:${coords}?q=${coords}(${encodedLabel})`,
        ];

  const webFallback = `https://www.google.com/maps/dir/?api=1&destination=${coords}`;

  for (const url of candidates) {
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return true;
      }
    } catch {
      continue;
    }
  }

  try {
    await Linking.openURL(webFallback);
    return true;
  } catch {
    return false;
  }
};
