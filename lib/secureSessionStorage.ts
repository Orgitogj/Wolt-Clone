import AsyncStorage from '@react-native-async-storage/async-storage';
import { Counter, ModeOfOperation, utils } from 'aes-js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface SessionStorageAdapter {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

const ENCRYPTION_KEY_BYTES = 32;
const CIPHERTEXT_PREFIX = 'secure-session.';
const SECURE_STORE_KEY_PATTERN = /[^A-Za-z0-9._-]/g;

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export const ciphertextKeyOf = (key: string): string => `${CIPHERTEXT_PREFIX}${key}`;

export const encryptionKeyNameOf = (key: string): string =>
  ciphertextKeyOf(key).replace(SECURE_STORE_KEY_PATTERN, '_');

export const defaultSessionStorageKey = (supabaseUrl: string): string =>
  `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

export const sessionStorageKey = (): string | null => {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!url) return null;

  try {
    return defaultSessionStorageKey(url);
  } catch {
    return null;
  }
};

const queues = new Map<string, Promise<unknown>>();

const serialize = <T>(key: string, operation: () => Promise<T>): Promise<T> => {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  queues.set(
    key,
    next.catch(() => undefined)
  );
  return next;
};

const isWeb = (): boolean => Platform.OS === 'web';

const webStorage = (): Storage | null => {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
};

const encrypt = async (key: string, value: string): Promise<string> => {
  const encryptionKey = await Crypto.getRandomBytesAsync(ENCRYPTION_KEY_BYTES);
  const cipher = new ModeOfOperation.ctr(encryptionKey, new Counter(1));
  const ciphertext = cipher.encrypt(utils.utf8.toBytes(value));

  await SecureStore.setItemAsync(
    encryptionKeyNameOf(key),
    utils.hex.fromBytes(encryptionKey),
    SECURE_STORE_OPTIONS
  );

  return utils.hex.fromBytes(ciphertext);
};

const decrypt = async (key: string, ciphertext: string): Promise<string | null> => {
  const encryptionKeyHex = await SecureStore.getItemAsync(
    encryptionKeyNameOf(key),
    SECURE_STORE_OPTIONS
  );
  if (!encryptionKeyHex) return null;

  const cipher = new ModeOfOperation.ctr(utils.hex.toBytes(encryptionKeyHex), new Counter(1));
  return utils.utf8.fromBytes(cipher.decrypt(utils.hex.toBytes(ciphertext)));
};

const forget = async (key: string): Promise<void> => {
  await AsyncStorage.removeItem(ciphertextKeyOf(key));
  await SecureStore.deleteItemAsync(encryptionKeyNameOf(key), SECURE_STORE_OPTIONS);
};

const write = async (key: string, value: string): Promise<void> => {
  const ciphertext = await encrypt(key, value);
  await AsyncStorage.setItem(ciphertextKeyOf(key), ciphertext);
};

const migrateLegacySession = async (key: string): Promise<string | null> => {
  const legacy = await AsyncStorage.getItem(key);
  if (legacy === null) return null;

  try {
    await write(key, legacy);
  } catch {
    return legacy;
  }

  await AsyncStorage.removeItem(key);
  return legacy;
};

const clearKey = async (key: string): Promise<void> => {
  if (isWeb()) {
    webStorage()?.removeItem(key);
    return;
  }

  await AsyncStorage.removeItem(key);
  await forget(key);
};

export const clearStoredSession = async (): Promise<void> => {
  const key = sessionStorageKey();
  if (!key) return;
  await serialize(key, () => clearKey(key));
};

const read = async (key: string): Promise<string | null> => {
  if (isWeb()) return webStorage()?.getItem(key) ?? null;

  const ciphertext = await AsyncStorage.getItem(ciphertextKeyOf(key));
  if (ciphertext === null) return migrateLegacySession(key);

  try {
    const value = await decrypt(key, ciphertext);
    if (value === null) await forget(key);
    return value;
  } catch {
    await forget(key);
    return null;
  }
};

const save = async (key: string, value: string): Promise<void> => {
  if (isWeb()) {
    webStorage()?.setItem(key, value);
    return;
  }

  await write(key, value);
  await AsyncStorage.removeItem(key);
};

export const secureSessionStorage: SessionStorageAdapter = {
  getItem: (key) => serialize(key, () => read(key)),
  setItem: (key, value) => serialize(key, () => save(key, value)),
  removeItem: (key) => serialize(key, () => clearKey(key)),
};
