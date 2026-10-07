export interface MockChannel {
  name: string;
  handlers: ((payload: unknown) => void)[];
  statusCallback: ((status: string) => void) | null;
  removed: boolean;
}

export const mockChannelRegistry: MockChannel[] = [];

export const resetChannelRegistry = () => {
  mockChannelRegistry.length = 0;
};

export const findChannel = (prefix: string): MockChannel | undefined =>
  mockChannelRegistry.filter((channel) => channel.name.startsWith(prefix)).at(-1);

export const createRealtimeSupabaseMock = () => ({
  channel: (name: string) => {
    const entry: MockChannel = {
      name,
      handlers: [],
      statusCallback: null,
      removed: false,
    };
    mockChannelRegistry.push(entry);

    const api = {
      name,
      on: (_event: string, _filter: unknown, handler: (payload: unknown) => void) => {
        entry.handlers.push(handler);
        return api;
      },
      subscribe: (callback?: (status: string) => void) => {
        entry.statusCallback = callback ?? null;
        return api;
      },
    };

    return api;
  },
  removeChannel: (channel: { name: string }) => {
    const entry = mockChannelRegistry.find((item) => item.name === channel.name);
    if (entry) entry.removed = true;
  },
});
