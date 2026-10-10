import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ciphertextKeyOf,
  clearStoredSession,
  defaultSessionStorageKey,
  encryptionKeyNameOf,
  secureSessionStorage,
  sessionStorageKey,
} from '@/lib/secureSessionStorage';
import * as SecureStore from 'expo-secure-store';

const SESSION_KEY = 'sb-test-auth-token';

const session = (refreshToken: string) =>
  JSON.stringify({
    access_token: 'a'.repeat(2200),
    refresh_token: refreshToken,
    expires_at: 1800000000,
    token_type: 'bearer',
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'person@test.local' },
  });

const storedCiphertext = () => AsyncStorage.getItem(ciphertextKeyOf(SESSION_KEY));
const storedKey = () => SecureStore.getItemAsync(encryptionKeyNameOf(SESSION_KEY));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await SecureStore.deleteItemAsync(encryptionKeyNameOf(SESSION_KEY));
});

describe('the storage key', () => {
  it('matches the key supabase-js derives from the project url', () => {
    expect(defaultSessionStorageKey('https://abcdefgh.supabase.co')).toBe(
      'sb-abcdefgh-auth-token'
    );
    expect(sessionStorageKey()).toBe(SESSION_KEY);
  });

  it('keeps the encrypted blob out of the plaintext key', () => {
    expect(ciphertextKeyOf(SESSION_KEY)).not.toBe(SESSION_KEY);
    expect(ciphertextKeyOf(SESSION_KEY)).toContain(SESSION_KEY);
  });

  it('only uses characters SecureStore accepts for a key', () => {
    expect(encryptionKeyNameOf('sb-ref-auth-token')).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(encryptionKeyNameOf('weird key/with:chars')).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe('round trip', () => {
  it('returns exactly what was stored', async () => {
    const value = session('refresh-1');

    await secureSessionStorage.setItem(SESSION_KEY, value);

    await expect(secureSessionStorage.getItem(SESSION_KEY)).resolves.toBe(value);
  });

  it('never writes the session in plain text', async () => {
    const value = session('super-secret-refresh-token');

    await secureSessionStorage.setItem(SESSION_KEY, value);

    const ciphertext = await storedCiphertext();
    expect(ciphertext).not.toBeNull();
    expect(ciphertext).not.toContain('super-secret-refresh-token');
    expect(ciphertext).not.toContain('access_token');
    expect(await AsyncStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('keeps only the key in SecureStore, which has a small value limit', async () => {
    const value = session('refresh-2');

    await secureSessionStorage.setItem(SESSION_KEY, value);

    const key = await storedKey();
    expect(value.length).toBeGreaterThan(2048);
    expect(key).toHaveLength(64);
  });

  it('encrypts a session larger than the SecureStore value limit', async () => {
    const value = JSON.stringify({ access_token: 'x'.repeat(6000) });

    await secureSessionStorage.setItem(SESSION_KEY, value);

    await expect(secureSessionStorage.getItem(SESSION_KEY)).resolves.toBe(value);
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  });

  it('uses a fresh key for every write so the keystream is never reused', async () => {
    await secureSessionStorage.setItem(SESSION_KEY, session('refresh-a'));
    const firstKey = await storedKey();

    await secureSessionStorage.setItem(SESSION_KEY, session('refresh-b'));
    const secondKey = await storedKey();

    expect(firstKey).not.toBe(secondKey);
  });

  it('returns the newest session after a refresh overwrites it', async () => {
    await secureSessionStorage.setItem(SESSION_KEY, session('refresh-old'));
    await secureSessionStorage.setItem(SESSION_KEY, session('refresh-new'));

    await expect(secureSessionStorage.getItem(SESSION_KEY)).resolves.toBe(
      session('refresh-new')
    );
  });

  it('reports no session when nothing is stored', async () => {
    await expect(secureSessionStorage.getItem(SESSION_KEY)).resolves.toBeNull();
  });

  it('asks SecureStore for a key that survives a locked device', async () => {
    await secureSessionStorage.setItem(SESSION_KEY, session('refresh-3'));

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      encryptionKeyNameOf(SESSION_KEY),
      expect.any(String),
      { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }
    );
  });
});

describe('concurrent access', () => {
  it('leaves a matching key and blob after simultaneous writes', async () => {
    await Promise.all([
      secureSessionStorage.setItem(SESSION_KEY, session('refresh-first')),
      secureSessionStorage.setItem(SESSION_KEY, session('refresh-second')),
      secureSessionStorage.setItem(SESSION_KEY, session('refresh-third')),
    ]);

    const value = await secureSessionStorage.getItem(SESSION_KEY);
    expect(value).not.toBeNull();
    expect([
      session('refresh-first'),
      session('refresh-second'),
      session('refresh-third'),
    ]).toContain(value);
  });

  it('keeps the last write when a read races it', async () => {
    await secureSessionStorage.setItem(SESSION_KEY, session('refresh-before'));

    const [, value] = await Promise.all([
      secureSessionStorage.setItem(SESSION_KEY, session('refresh-after')),
      secureSessionStorage.getItem(SESSION_KEY),
    ]);

    expect([session('refresh-before'), session('refresh-after')]).toContain(value);
    await expect(secureSessionStorage.getItem(SESSION_KEY)).resolves.toBe(
      session('refresh-after')
    );
  });

  it('reports no session when a removal races a write', async () => {
    await secureSessionStorage.setItem(SESSION_KEY, session('refresh-doomed'));

    await Promise.all([
      secureSessionStorage.setItem(SESSION_KEY, session('refresh-doomed')),
      secureSessionStorage.removeItem(SESSION_KEY),
    ]);

    await expect(secureSessionStorage.getItem(SESSION_KEY)).resolves.toBeNull();
  });

  it('survives a failing operation and keeps serving the next one', async () => {
    jest
      .spyOn(SecureStore, 'setItemAsync')
      .mockRejectedValueOnce(new Error('keychain unavailable'));

    await expect(
      secureSessionStorage.setItem(SESSION_KEY, session('refresh-fails'))
    ).rejects.toThrow('keychain unavailable');

    await secureSessionStorage.setItem(SESSION_KEY, session('refresh-works'));
    await expect(secureSessionStorage.getItem(SESSION_KEY)).resolves.toBe(
      session('refresh-works')
    );
  });
});

describe('migrating the old plaintext session', () => {
  it('moves an existing session into the encrypted store on first read', async () => {
    const value = session('legacy-refresh');
    await AsyncStorage.setItem(SESSION_KEY, value);

    await expect(secureSessionStorage.getItem(SESSION_KEY)).resolves.toBe(value);

    expect(await AsyncStorage.getItem(SESSION_KEY)).toBeNull();
    expect(await storedCiphertext()).not.toBeNull();
    expect(await storedKey()).not.toBeNull();
  });

  it('keeps the user signed in after the move', async () => {
    const value = session('legacy-refresh');
    await AsyncStorage.setItem(SESSION_KEY, value);

    await secureSessionStorage.getItem(SESSION_KEY);

    await expect(secureSessionStorage.getItem(SESSION_KEY)).resolves.toBe(value);
  });

  it('leaves the encrypted session alone when one already exists', async () => {
    await secureSessionStorage.setItem(SESSION_KEY, session('current'));
    await AsyncStorage.setItem(SESSION_KEY, session('stale-plaintext'));

    await expect(secureSessionStorage.getItem(SESSION_KEY)).resolves.toBe(session('current'));
  });

  it('removes a stale plaintext copy on the next write', async () => {
    await AsyncStorage.setItem(SESSION_KEY, session('stale-plaintext'));

    await secureSessionStorage.setItem(SESSION_KEY, session('current'));

    expect(await AsyncStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('keeps the user signed in when the encrypted write fails', async () => {
    const value = session('legacy-refresh');
    await AsyncStorage.setItem(SESSION_KEY, value);
    jest
      .spyOn(SecureStore, 'setItemAsync')
      .mockRejectedValueOnce(new Error('keychain unavailable'));

    await expect(secureSessionStorage.getItem(SESSION_KEY)).resolves.toBe(value);
    expect(await AsyncStorage.getItem(SESSION_KEY)).toBe(value);
  });
});

describe('a half written or tampered store', () => {
  it('reports no session when the key is gone', async () => {
    await secureSessionStorage.setItem(SESSION_KEY, session('refresh-4'));
    await SecureStore.deleteItemAsync(encryptionKeyNameOf(SESSION_KEY));

    await expect(secureSessionStorage.getItem(SESSION_KEY)).resolves.toBeNull();
    expect(await storedCiphertext()).toBeNull();
  });

  it('reports no session when the blob cannot be decrypted', async () => {
    await secureSessionStorage.setItem(SESSION_KEY, session('refresh-5'));
    await AsyncStorage.setItem(ciphertextKeyOf(SESSION_KEY), 'not-hex-at-all');

    await expect(secureSessionStorage.getItem(SESSION_KEY)).resolves.toBeNull();
    expect(await storedCiphertext()).toBeNull();
    expect(await storedKey()).toBeNull();
  });
});

describe('removal', () => {
  it('removes the blob and the key together', async () => {
    await secureSessionStorage.setItem(SESSION_KEY, session('refresh-6'));

    await secureSessionStorage.removeItem(SESSION_KEY);

    expect(await storedCiphertext()).toBeNull();
    expect(await storedKey()).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      encryptionKeyNameOf(SESSION_KEY),
      expect.anything()
    );
  });

  it('also removes a legacy plaintext session', async () => {
    await AsyncStorage.setItem(SESSION_KEY, session('legacy-refresh'));

    await secureSessionStorage.removeItem(SESSION_KEY);

    expect(await AsyncStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('clears the session for the configured project on sign out', async () => {
    await secureSessionStorage.setItem(SESSION_KEY, session('refresh-7'));
    await AsyncStorage.setItem(SESSION_KEY, session('legacy-refresh'));

    await clearStoredSession();

    expect(await storedCiphertext()).toBeNull();
    expect(await storedKey()).toBeNull();
    expect(await AsyncStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('leaves nothing readable behind after sign out', async () => {
    await secureSessionStorage.setItem(SESSION_KEY, session('refresh-8'));

    await clearStoredSession();

    await expect(secureSessionStorage.getItem(SESSION_KEY)).resolves.toBeNull();
  });

  it('does nothing when the project url is missing', async () => {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;

    try {
      expect(sessionStorageKey()).toBeNull();
      await expect(clearStoredSession()).resolves.toBeUndefined();
    } finally {
      process.env.EXPO_PUBLIC_SUPABASE_URL = url;
    }
  });
});

describe('the cart and the filters', () => {
  it('are left in plain storage because they are not secrets', async () => {
    await AsyncStorage.setItem('cart-storage', JSON.stringify({ items: [] }));
    await secureSessionStorage.setItem(SESSION_KEY, session('refresh-9'));

    await clearStoredSession();

    expect(await AsyncStorage.getItem('cart-storage')).not.toBeNull();
  });
});
