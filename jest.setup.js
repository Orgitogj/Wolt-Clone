process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-crypto', () => {
  let counter = 0;
  return {
    randomUUID: () => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
    },
  };
});

jest.mock('expo-linking', () => ({
  createURL: (path) => `wolt://${path}`,
}));

const mockIconModule = () => {
  const React = require('react');
  const { Text } = require('react-native');
  const Icon = (props) => React.createElement(Text, { testID: props.testID });
  return new Proxy(
    { __esModule: true, default: Icon },
    { get: (target, key) => (key in target ? target[key] : Icon) }
  );
};

jest.mock('@expo/vector-icons', () => mockIconModule());
jest.mock('@expo/vector-icons/Ionicons', () => mockIconModule());
jest.mock('@expo/vector-icons/FontAwesome5', () => mockIconModule());
jest.mock('@expo/vector-icons/MaterialIcons', () => mockIconModule());
