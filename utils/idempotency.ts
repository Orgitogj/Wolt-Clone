import * as Crypto from 'expo-crypto';

export const createIdempotencyKey = (): string => Crypto.randomUUID();
