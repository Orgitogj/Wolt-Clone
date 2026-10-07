jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/realtime').createRealtimeSupabaseMock(),
}));

const mockAuthState: { user: { id: string } | null } = { user: { id: 'user-a' } };

jest.mock('@/hooks/use-auth-store', () => ({
  __esModule: true,
  default: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

const mockGetOrderById = jest.fn();
const mockGetStatusHistory = jest.fn();
const mockGetDeliveryForOrder = jest.fn();
const mockGetTrackedCourier = jest.fn();
const mockListDeliveryLocations = jest.fn();

jest.mock('@/services/orderService', () => ({
  orderService: {
    getOrderById: (...args: unknown[]) => mockGetOrderById(...args),
    getStatusHistory: (...args: unknown[]) => mockGetStatusHistory(...args),
  },
}));

jest.mock('@/services/courierService', () => ({
  courierService: {
    getDeliveryForOrder: (...args: unknown[]) => mockGetDeliveryForOrder(...args),
    getTrackedCourier: (...args: unknown[]) => mockGetTrackedCourier(...args),
    listDeliveryLocations: (...args: unknown[]) => mockListDeliveryLocations(...args),
  },
}));

import { useOrderTracking } from '@/hooks/useOrderTracking';
import {
  findChannel,
  mockChannelRegistry,
  resetChannelRegistry,
} from './helpers/realtime';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const channelFor = (prefix: string) => findChannel(prefix);

const connectAll = async () => {
  await act(async () => {
    mockChannelRegistry.forEach((channel) => channel.statusCallback?.('SUBSCRIBED'));
    await Promise.resolve();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  resetChannelRegistry();
  mockAuthState.user = { id: 'user-a' };
  queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });

  mockGetOrderById.mockResolvedValue({
    id: 'order-1',
    status: 'delivering',
    restaurant_id: 'restaurant-1',
  });
  mockGetStatusHistory.mockResolvedValue([]);
  mockGetDeliveryForOrder.mockResolvedValue({ id: 'delivery-1', status: 'delivering' });
  mockGetTrackedCourier.mockResolvedValue({ id: 'courier-1', full_name: 'Sam' });
  mockListDeliveryLocations.mockResolvedValue([]);
});

describe('subscription scoping', () => {
  it('subscribes to the order it was given', async () => {
    renderHook(() => useOrderTracking('order-1'), { wrapper });
    await waitFor(() => expect(channelFor('track-order-')).toBeDefined());

    expect(channelFor('track-order-')?.name).toBe('track-order-order-1');
  });

  it('does not subscribe without a signed in account', async () => {
    mockAuthState.user = null;

    renderHook(() => useOrderTracking('order-1'), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });

    expect(channelFor('track-order-')).toBeUndefined();
  });

  it('does not subscribe without an order id', async () => {
    renderHook(() => useOrderTracking(undefined), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      mockChannelRegistry.filter((channel) => !channel.name.includes('none'))
    ).toHaveLength(0);
  });

  it('never queries another account order', async () => {
    mockAuthState.user = null;

    renderHook(() => useOrderTracking('order-1'), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetOrderById).not.toHaveBeenCalled();
  });
});

describe('cleanup', () => {
  it('removes its channels on unmount', async () => {
    const view = renderHook(() => useOrderTracking('order-1'), { wrapper });
    await waitFor(() => expect(channelFor('track-order-')).toBeDefined());

    view.unmount();

    expect(channelFor('track-order-')?.removed).toBe(true);
  });

  it('tears down subscriptions once the order reaches a terminal state', async () => {
    mockGetOrderById.mockResolvedValue({
      id: 'order-1',
      status: 'delivered',
      restaurant_id: 'restaurant-1',
    });
    mockGetDeliveryForOrder.mockResolvedValue({ id: 'delivery-1', status: 'delivered' });

    const { result } = renderHook(() => useOrderTracking('order-1'), { wrapper });

    await waitFor(() => expect(result.current.isTerminal).toBe(true));
    await waitFor(() => expect(channelFor('track-order-')?.removed).toBe(true));
  });

  it('stops tracking when the account changes', async () => {
    const view = renderHook(() => useOrderTracking('order-1'), { wrapper });
    await waitFor(() => expect(channelFor('track-order-')).toBeDefined());

    mockAuthState.user = null;
    view.rerender(undefined);

    await waitFor(() => expect(channelFor('track-order-')?.removed).toBe(true));
  });
});

describe('connection state', () => {
  it('reports connected once the channel subscribes', async () => {
    const { result } = renderHook(() => useOrderTracking('order-1'), { wrapper });
    await waitFor(() => expect(channelFor('track-order-')).toBeDefined());

    await connectAll();

    expect(result.current.connection).toBe('connected');
  });

  it('reports a dropped connection', async () => {
    const { result } = renderHook(() => useOrderTracking('order-1'), { wrapper });
    await waitFor(() => expect(channelFor('track-order-')).toBeDefined());

    await act(async () => {
      channelFor('track-order-')?.statusCallback?.('CHANNEL_ERROR');
      await Promise.resolve();
    });

    expect(result.current.connection).toBe('disconnected');
  });

  it('refetches after reconnecting so missed events are picked up', async () => {
    renderHook(() => useOrderTracking('order-1'), { wrapper });
    await waitFor(() => expect(mockGetOrderById).toHaveBeenCalled());

    const callsBefore = mockGetOrderById.mock.calls.length;
    await connectAll();

    await waitFor(() =>
      expect(mockGetOrderById.mock.calls.length).toBeGreaterThan(callsBefore)
    );
  });
});

describe('event ordering', () => {
  it('keeps the newest courier position when an older event arrives late', async () => {
    const { result } = renderHook(() => useOrderTracking('order-1'), { wrapper });
    await waitFor(() => expect(channelFor('track-location-')).toBeDefined());

    const location = channelFor('track-location-');

    await act(async () => {
      location?.handlers.forEach((handler) =>
        handler({
          new: { latitude: 51.1, longitude: 7.1, recorded_at: '2026-01-01T10:05:00.000Z' },
        })
      );
      await Promise.resolve();
    });

    expect(result.current.courierPosition?.latitude).toBe(51.1);

    await act(async () => {
      location?.handlers.forEach((handler) =>
        handler({
          new: { latitude: 50.0, longitude: 7.0, recorded_at: '2026-01-01T10:01:00.000Z' },
        })
      );
      await Promise.resolve();
    });

    expect(result.current.courierPosition?.latitude).toBe(51.1);
  });

  it('accepts a newer position', async () => {
    const { result } = renderHook(() => useOrderTracking('order-1'), { wrapper });
    await waitFor(() => expect(channelFor('track-location-')).toBeDefined());

    const location = channelFor('track-location-');

    await act(async () => {
      location?.handlers.forEach((handler) =>
        handler({
          new: { latitude: 51.1, longitude: 7.1, recorded_at: '2026-01-01T10:05:00.000Z' },
        })
      );
      await Promise.resolve();
    });

    await act(async () => {
      location?.handlers.forEach((handler) =>
        handler({
          new: { latitude: 52.2, longitude: 7.2, recorded_at: '2026-01-01T10:09:00.000Z' },
        })
      );
      await Promise.resolve();
    });

    expect(result.current.courierPosition?.latitude).toBe(52.2);
  });

  it('ignores a location event without coordinates', async () => {
    const { result } = renderHook(() => useOrderTracking('order-1'), { wrapper });
    await waitFor(() => expect(channelFor('track-location-')).toBeDefined());

    await act(async () => {
      channelFor('track-location-')?.handlers.forEach((handler) =>
        handler({ new: { latitude: null, longitude: null } })
      );
      await Promise.resolve();
    });

    expect(result.current.courierPosition).toBeNull();
  });
});

describe('authorised information only', () => {
  it('hides courier details once the delivery is no longer live', async () => {
    mockGetDeliveryForOrder.mockResolvedValue({ id: 'delivery-1', status: 'delivered' });
    mockGetOrderById.mockResolvedValue({
      id: 'order-1',
      status: 'delivered',
      restaurant_id: 'restaurant-1',
    });

    const { result } = renderHook(() => useOrderTracking('order-1'), { wrapper });

    await waitFor(() => expect(result.current.isTerminal).toBe(true));

    expect(result.current.courier).toBeUndefined();
    expect(result.current.courierPosition).toBeNull();
  });

  it('does not request courier details while the delivery is not live', async () => {
    mockGetDeliveryForOrder.mockResolvedValue({ id: 'delivery-1', status: 'pending' });

    renderHook(() => useOrderTracking('order-1'), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetTrackedCourier).not.toHaveBeenCalled();
  });
});
