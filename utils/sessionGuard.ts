let epoch = 0;

export const currentSessionEpoch = (): number => epoch;

export const bumpSessionEpoch = (): number => {
  epoch += 1;
  return epoch;
};

export const isStaleSession = (capturedEpoch: number): boolean => capturedEpoch !== epoch;

export const resetSessionEpochForTests = () => {
  epoch = 0;
};
