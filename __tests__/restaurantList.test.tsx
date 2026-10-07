jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), dismiss: jest.fn() }),
}));

import RestaurantList from '@/components/RestaurantList';
import type { Restaurant } from '@/types/database';
import { fireEvent, render, screen } from '@testing-library/react-native';

const restaurant = (id: string, overrides: Partial<Restaurant> = {}): Restaurant =>
  ({
    id,
    name: `Restaurant ${id}`,
    description: 'Tasty food',
    image_url: null,
    rating: 4.5,
    review_count: 10,
    delivery_time_min: 15,
    delivery_time_max: 30,
    delivery_fee: 1.5,
    min_order: 0,
    address: null,
    latitude: null,
    longitude: null,
    is_open: true,
    cuisines: [],
    tags: [],
    opening_hours: null,
    timezone: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as Restaurant;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('results', () => {
  it('renders a card per restaurant', () => {
    render(<RestaurantList restaurants={[restaurant('a'), restaurant('b')]} />);

    expect(screen.getByText('Restaurant a')).toBeTruthy();
    expect(screen.getByText('Restaurant b')).toBeTruthy();
  });

  it('opens the restaurant modal with the right id', () => {
    render(<RestaurantList restaurants={[restaurant('abc')]} />);

    fireEvent.press(screen.getByTestId('restaurant-card-abc'));

    expect(mockPush).toHaveBeenCalledWith('/(modal)/(restaurant)/abc');
  });

  it('marks a closed restaurant', () => {
    render(<RestaurantList restaurants={[restaurant('a', { is_open: false })]} />);

    expect(screen.getByText('Closed')).toBeTruthy();
  });
});

describe('loading, empty and error states', () => {
  it('shows a spinner while the first page loads', () => {
    render(<RestaurantList restaurants={[]} isLoading />);

    expect(screen.getByTestId('restaurant-list-loading')).toBeTruthy();
  });

  it('shows the empty message when the server returned nothing', () => {
    render(<RestaurantList restaurants={[]} emptyMessage="No restaurants match your filters." />);

    expect(screen.getByText('No restaurants match your filters.')).toBeTruthy();
  });

  it('shows a retry affordance when the query failed', () => {
    const onRetry = jest.fn();
    render(<RestaurantList restaurants={[]} error={new Error('network down')} onRetry={onRetry} />);

    fireEvent.press(screen.getByText('Try again'));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not show a raw backend error to the user', () => {
    render(
      <RestaurantList
        restaurants={[]}
        error={new Error('PGRST116: JWT expired at /rest/v1/restaurants')}
        onRetry={jest.fn()}
      />
    );

    expect(screen.queryByText(/PGRST116/)).toBeNull();
    expect(screen.getByText('We could not load restaurants')).toBeTruthy();
  });

  it('prefers results over the error state once data has arrived', () => {
    render(<RestaurantList restaurants={[restaurant('a')]} error={new Error('stale failure')} />);

    expect(screen.getByText('Restaurant a')).toBeTruthy();
    expect(screen.queryByText('We could not load restaurants')).toBeNull();
  });
});

describe('paging', () => {
  it('shows a footer spinner while the next page loads', () => {
    render(<RestaurantList restaurants={[restaurant('a')]} isFetchingNextPage />);

    expect(screen.getByText('Restaurant a')).toBeTruthy();
  });

  it('renders through a single virtualized list', () => {
    render(<RestaurantList restaurants={[restaurant('a')]} />);

    expect(screen.getByTestId('restaurant-list')).toBeTruthy();
  });
});
