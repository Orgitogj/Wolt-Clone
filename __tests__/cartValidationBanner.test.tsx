jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

import { CartValidationBanner } from '@/components/checkout/CartValidationBanner';
import type { CartValidationState } from '@/hooks/useCartValidation';
import type { CartValidation } from '@/types/database';
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockAcknowledge = jest.fn();
const mockUpdateCart = jest.fn();
const mockRecheck = jest.fn();

const validation = (overrides: Partial<CartValidation> = {}): CartValidation => ({
  restaurant_id: 'rest-1',
  restaurant_name: 'Kitchen',
  is_open: true,
  min_order: 10,
  currency: 'EUR',
  max_item_quantity: 20,
  subtotal: 12,
  meets_min_order: true,
  has_changes: true,
  lines: [],
  ...overrides,
});

const state = (overrides: Partial<CartValidationState> = {}): CartValidationState => ({
  validation: validation(),
  notices: ['Prices changed'],
  isChecking: false,
  error: null,
  needsReview: true,
  isAcknowledged: false,
  acknowledge: mockAcknowledge,
  updateCart: mockUpdateCart,
  recheck: mockRecheck,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('nothing to report', () => {
  it('shows no banner when the basket is unchanged', () => {
    render(<CartValidationBanner state={state({ needsReview: false, notices: [] })} />);

    expect(screen.queryByTestId('cart-validation-banner')).toBeNull();
  });

  it('shows no banner when there is nothing to say', () => {
    render(<CartValidationBanner state={state({ notices: [] })} />);

    expect(screen.queryByTestId('cart-validation-banner')).toBeNull();
  });
});

describe('while the basket is being checked', () => {
  it('says so before the first result arrives', () => {
    render(<CartValidationBanner state={state({ isChecking: true, validation: undefined })} />);

    expect(screen.getByTestId('cart-validation-checking')).toBeTruthy();
    expect(screen.queryByTestId('cart-validation-banner')).toBeNull();
  });

  it('keeps showing the changes while it rechecks', () => {
    render(<CartValidationBanner state={state({ isChecking: true })} />);

    expect(screen.getByTestId('cart-validation-banner')).toBeTruthy();
    expect(screen.queryByTestId('cart-validation-checking')).toBeNull();
  });
});

describe('when the check fails', () => {
  it('offers a retry instead of a silent pass', () => {
    render(<CartValidationBanner state={state({ error: new Error('offline') })} />);

    expect(screen.getByTestId('cart-validation-error')).toBeTruthy();

    fireEvent.press(screen.getByTestId('cart-validation-retry'));
    expect(mockRecheck).toHaveBeenCalled();
  });
});

describe('when the basket changed', () => {
  it('lists every notice', () => {
    render(
      <CartValidationBanner
        state={state({ notices: ['Prices changed', 'Pizza is no longer available'] })}
      />
    );

    expect(screen.getAllByTestId('cart-validation-notice')).toHaveLength(2);
    expect(screen.getByText('Pizza is no longer available')).toBeTruthy();
  });

  it('updates the cart on request', () => {
    render(<CartValidationBanner state={state()} />);

    fireEvent.press(screen.getByTestId('cart-validation-update'));

    expect(mockUpdateCart).toHaveBeenCalled();
  });

  it('lets the customer keep the basket as it is', () => {
    render(<CartValidationBanner state={state()} />);

    fireEvent.press(screen.getByTestId('cart-validation-acknowledge'));

    expect(mockAcknowledge).toHaveBeenCalled();
  });

  it('shows the basket as reviewed once acknowledged', () => {
    render(<CartValidationBanner state={state({ isAcknowledged: true })} />);

    expect(screen.getByText('Reviewed')).toBeTruthy();
    expect(
      screen.getByTestId('cart-validation-acknowledge').props.accessibilityState.selected
    ).toBe(true);
  });
});
