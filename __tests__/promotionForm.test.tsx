jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

import {
  buildPromotionDraft,
  emptyPromotionForm,
  formFromPromotion,
  type PromotionFormState,
} from '@/components/promotions/PromotionForm';
import { RestaurantSelector } from '@/components/promotions/RestaurantSelector';
import { supabase } from '@/lib/supabase';
import type { AdminPromotion } from '@/types/database';
import {
  formatUtcPreview,
  localPartsToUtcIso,
  utcIsoToLocalParts,
  validateScheduleWindow,
} from '@/utils/datetime';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type { SupabaseMock } from './helpers/supabase';

const mocked = supabase as unknown as SupabaseMock;

const form = (overrides: Partial<PromotionFormState> = {}): PromotionFormState => ({
  ...emptyPromotionForm,
  code: 'SAVE10',
  discountValue: '10',
  ...overrides,
});

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
});

describe('local time to UTC conversion', () => {
  it('round trips a local instant through UTC without drift', () => {
    const iso = localPartsToUtcIso('2026-06-01', '14:30');
    expect(iso).not.toBeNull();

    const parts = utcIsoToLocalParts(iso);
    expect(parts).toEqual({ date: '2026-06-01', time: '14:30' });
  });

  it('converts the entered local time to the matching UTC instant', () => {
    const iso = localPartsToUtcIso('2026-06-01', '14:30')!;
    const expected = new Date(2026, 5, 1, 14, 30, 0, 0).toISOString();

    expect(iso).toBe(expected);
  });

  it('treats an empty pair as no schedule', () => {
    expect(localPartsToUtcIso('', '')).toBeNull();
  });

  it('rejects a malformed date', () => {
    expect(localPartsToUtcIso('01/06/2026', '14:30')).toBeNull();
    expect(localPartsToUtcIso('2026-13-01', '14:30')).toBeNull();
    expect(localPartsToUtcIso('2026-02-31', '14:30')).toBeNull();
  });

  it('rejects a malformed time', () => {
    expect(localPartsToUtcIso('2026-06-01', '25:00')).toBeNull();
    expect(localPartsToUtcIso('2026-06-01', '14:71')).toBeNull();
    expect(localPartsToUtcIso('2026-06-01', 'noon')).toBeNull();
  });

  it('reads an empty value back as empty parts', () => {
    expect(utcIsoToLocalParts(null)).toEqual({ date: '', time: '' });
    expect(utcIsoToLocalParts('not a date')).toEqual({ date: '', time: '' });
  });

  it('labels the preview as UTC', () => {
    expect(formatUtcPreview('2026-06-01T12:00:00.000Z')).toBe('2026-06-01 12:00 UTC');
    expect(formatUtcPreview(null)).toBe('Not set');
  });
});

describe('schedule validation', () => {
  it('accepts an end later than the start', () => {
    const result = validateScheduleWindow('2026-06-01', '10:00', '2026-06-02', '10:00');

    expect(result.error).toBeNull();
    expect(result.window.startsAt).not.toBeNull();
    expect(result.window.endsAt).not.toBeNull();
  });

  it('rejects an end before the start', () => {
    expect(validateScheduleWindow('2026-06-02', '10:00', '2026-06-01', '10:00').error).toBe(
      'end_before_start'
    );
  });

  it('rejects an end equal to the start', () => {
    expect(validateScheduleWindow('2026-06-01', '10:00', '2026-06-01', '10:00').error).toBe(
      'end_before_start'
    );
  });

  it('accepts only a start', () => {
    const result = validateScheduleWindow('2026-06-01', '10:00', '', '');

    expect(result.error).toBeNull();
    expect(result.window.endsAt).toBeNull();
  });

  it('accepts no schedule at all', () => {
    const result = validateScheduleWindow('', '', '', '');

    expect(result.error).toBeNull();
    expect(result.window).toEqual({ startsAt: null, endsAt: null });
  });

  it('rejects a half filled start', () => {
    expect(validateScheduleWindow('2026-06-01', '', '', '').error).toBe('incomplete_start');
    expect(validateScheduleWindow('', '10:00', '', '').error).toBe('incomplete_start');
  });

  it('rejects a half filled end', () => {
    expect(validateScheduleWindow('', '', '2026-06-01', '').error).toBe('incomplete_end');
  });
});

describe('building the draft', () => {
  it('sends a UTC window to the server', () => {
    const { draft } = buildPromotionDraft(
      form({ startDate: '2026-06-01', startTime: '10:00', endDate: '2026-06-02', endTime: '10:00' }),
      null
    );

    expect(draft?.startsAt).toBe(new Date(2026, 5, 1, 10, 0, 0, 0).toISOString());
    expect(draft?.endsAt).toBe(new Date(2026, 5, 2, 10, 0, 0, 0).toISOString());
  });

  it('refuses an invalid range before reaching the server', () => {
    const { draft, error } = buildPromotionDraft(
      form({ startDate: '2026-06-02', startTime: '10:00', endDate: '2026-06-01', endTime: '10:00' }),
      null
    );

    expect(draft).toBeNull();
    expect(error).toBe('The end must be later than the start');
  });

  it('requires a code', () => {
    expect(buildPromotionDraft(form({ code: '   ' }), null).error).toBe('A promo code is required');
  });

  it('requires a positive discount', () => {
    expect(buildPromotionDraft(form({ discountValue: '0' }), null).error).toMatch(/greater than zero/);
    expect(buildPromotionDraft(form({ discountValue: 'abc' }), null).error).toMatch(/greater than zero/);
  });

  it('caps a percentage at 100', () => {
    expect(
      buildPromotionDraft(form({ discountType: 'percentage', discountValue: '150' }), null).error
    ).toMatch(/more than 100/);
  });

  it('rejects a negative minimum basket', () => {
    expect(buildPromotionDraft(form({ minSubtotal: '-5' }), null).error).toMatch(/cannot be negative/);
  });

  it('rejects a fractional use cap', () => {
    expect(buildPromotionDraft(form({ maxRedemptions: '2.5' }), null).error).toMatch(/whole number/);
    expect(buildPromotionDraft(form({ maxPerCustomer: '0' }), null).error).toMatch(/whole number/);
  });

  it('keeps the restaurant restriction', () => {
    const { draft } = buildPromotionDraft(
      form({ restaurantId: 'restaurant-1', restaurantName: 'Pizza Place' }),
      null
    );

    expect(draft?.restaurantId).toBe('restaurant-1');
  });

  it('sends null for all restaurants', () => {
    const { draft } = buildPromotionDraft(form({ restaurantId: null }), null);

    expect(draft?.restaurantId).toBeNull();
  });

  it('drops a max discount that cannot apply to a fixed promotion', () => {
    const { draft } = buildPromotionDraft(
      form({ discountType: 'fixed', discountValue: '5', maxDiscount: '3' }),
      null
    );

    expect(draft?.maxDiscount).toBeNull();
  });

  it('carries the id when editing', () => {
    const { draft } = buildPromotionDraft(form(), 'promo-1');

    expect(draft?.id).toBe('promo-1');
  });
});

describe('editing an existing promotion', () => {
  const promotion: AdminPromotion = {
    id: 'promo-1',
    code: 'SAVE20',
    description: 'Twenty off',
    discount_type: 'percentage',
    discount_value: 20,
    max_discount: 8,
    min_subtotal: 15,
    restaurant_id: 'restaurant-1',
    restaurant_name: 'Pizza Place',
    starts_at: '2026-06-01T10:00:00.000Z',
    ends_at: '2026-06-30T10:00:00.000Z',
    max_redemptions: 100,
    max_per_customer: 3,
    is_active: false,
    redeemed_count: 7,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  it('loads every stored value into the form', () => {
    const loaded = formFromPromotion(promotion);

    expect(loaded.code).toBe('SAVE20');
    expect(loaded.description).toBe('Twenty off');
    expect(loaded.discountType).toBe('percentage');
    expect(loaded.discountValue).toBe('20');
    expect(loaded.maxDiscount).toBe('8');
    expect(loaded.minSubtotal).toBe('15');
    expect(loaded.restaurantId).toBe('restaurant-1');
    expect(loaded.restaurantName).toBe('Pizza Place');
    expect(loaded.maxRedemptions).toBe('100');
    expect(loaded.maxPerCustomer).toBe('3');
    expect(loaded.isActive).toBe(false);
  });

  it('shows the stored window in local time', () => {
    const loaded = formFromPromotion(promotion);
    const expected = utcIsoToLocalParts('2026-06-01T10:00:00.000Z');

    expect(loaded.startDate).toBe(expected.date);
    expect(loaded.startTime).toBe(expected.time);
  });

  it('never silently replaces a stored value with a default', () => {
    const { draft } = buildPromotionDraft(formFromPromotion(promotion), promotion.id);

    expect(draft?.maxPerCustomer).toBe(3);
    expect(draft?.maxRedemptions).toBe(100);
    expect(draft?.minSubtotal).toBe(15);
    expect(draft?.isActive).toBe(false);
    expect(draft?.restaurantId).toBe('restaurant-1');
    expect(draft?.startsAt).toBe('2026-06-01T10:00:00.000Z');
    expect(draft?.endsAt).toBe('2026-06-30T10:00:00.000Z');
  });

  it('keeps an empty schedule empty rather than inventing one', () => {
    const loaded = formFromPromotion({ ...promotion, starts_at: null, ends_at: null });
    const { draft } = buildPromotionDraft(loaded, promotion.id);

    expect(draft?.startsAt).toBeNull();
    expect(draft?.endsAt).toBeNull();
  });
});

describe('restaurant selector', () => {
  afterEach(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
  });

  const page = (restaurants: { id: string; name: string }[]) =>
    Promise.resolve({ data: restaurants, error: null });

  it('offers an explicit all restaurants option', async () => {
    mocked.rpc.mockReturnValue(page([]));
    const onSelect = jest.fn();

    render(<RestaurantSelector selectedId={null} selectedName={null} onSelect={onSelect} />, {
      wrapper,
    });

    fireEvent.press(screen.getByTestId('restaurant-selector-trigger'));
    await waitFor(() => expect(screen.getByTestId('restaurant-option-all')).toBeTruthy());

    fireEvent.press(screen.getByTestId('restaurant-option-all'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('searches restaurants on the server', async () => {
    mocked.rpc.mockReturnValue(page([{ id: 'r1', name: 'Pizza Place' }]));

    render(<RestaurantSelector selectedId={null} selectedName={null} onSelect={jest.fn()} />, {
      wrapper,
    });

    fireEvent.press(screen.getByTestId('restaurant-selector-trigger'));
    await waitFor(() => expect(mocked.rpc).toHaveBeenCalledWith('search_restaurants', expect.anything()));

    expect(mocked.rpc.mock.calls[0][1]).toMatchObject({ p_limit: 20, p_offset: 0 });
  });

  it('selects a restaurant by id and name', async () => {
    mocked.rpc.mockReturnValue(page([{ id: 'r1', name: 'Pizza Place' }]));
    const onSelect = jest.fn();

    render(<RestaurantSelector selectedId={null} selectedName={null} onSelect={onSelect} />, {
      wrapper,
    });

    fireEvent.press(screen.getByTestId('restaurant-selector-trigger'));
    await waitFor(() => expect(screen.getByTestId('restaurant-option-r1')).toBeTruthy());

    fireEvent.press(screen.getByTestId('restaurant-option-r1'));
    expect(onSelect).toHaveBeenCalledWith({ id: 'r1', name: 'Pizza Place' });
  });

  it('shows the current restriction on the trigger', () => {
    mocked.rpc.mockReturnValue(page([]));

    render(
      <RestaurantSelector selectedId="r1" selectedName="Pizza Place" onSelect={jest.fn()} />,
      { wrapper }
    );

    expect(screen.getByText('Pizza Place')).toBeTruthy();
  });

  it('offers a retry when the search fails', async () => {
    mocked.rpc.mockReturnValue(Promise.resolve({ data: null, error: new Error('offline') }));

    render(<RestaurantSelector selectedId={null} selectedName={null} onSelect={jest.fn()} />, {
      wrapper,
    });

    fireEvent.press(screen.getByTestId('restaurant-selector-trigger'));
    await waitFor(() => expect(screen.getByTestId('restaurant-selector-retry')).toBeTruthy());
  });
});
