import AsyncStorage from '@react-native-async-storage/async-storage';
import { StateStorage } from 'zustand/middleware';

const zustandStorage: StateStorage = {
  setItem: (name, value) => {
    return AsyncStorage.setItem(name, value);
  },
  getItem: async (name) => {
    const value = await AsyncStorage.getItem(name);
    return value ?? null;
  },
  removeItem: (name) => {
    return AsyncStorage.removeItem(name);
  },
};

export default zustandStorage;