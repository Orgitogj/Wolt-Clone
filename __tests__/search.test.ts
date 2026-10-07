jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

import { supabase } from '@/lib/supabase';
import { menuService } from '@/services/menuService';
import { restaurantService } from '@/services/restaurantService';
import type { SupabaseMock } from './helpers/supabase';

const mocked = supabase as unknown as SupabaseMock;

const rpcResult = (data: unknown) => Promise.resolve({ data, error: null });

const makeRestaurants = (count: number, prefix = 'r') =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    name: `Restaurant ${index}`,
    cuisines: [],
    tags: [],
  }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('restaurant search goes to the server', () => {
  it('sends every filter to the search_restaurants function', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    await restaurantService.searchPage({
      search: '  sushi  ',
      categoryId: 'category-1',
      cuisines: ['Japanese'],
      priceTier: '€€',
      woltPlusOnly: true,
      sort: 'Rating',
    });

    expect(mocked.rpc).toHaveBeenCalledWith('search_restaurants', {
      p_search: 'sushi',
      p_category_id: 'category-1',
      p_cuisines: ['Japanese'],
      p_price_tier: '€€',
      p_wolt_plus_only: true,
      p_sort: 'Rating',
      p_limit: 20,
      p_offset: 0,
    });
  });

  it('treats a blank query as no text filter rather than an empty result', async () => {
    mocked.rpc.mockReturnValue(rpcResult(makeRestaurants(3)));

    const page = await restaurantService.searchPage({ search: '   ' });

    expect(mocked.rpc.mock.calls[0][1]).toMatchObject({ p_search: null });
    expect(page.restaurants).toHaveLength(3);
  });

  it('drops empty cuisine lists instead of filtering everything out', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    await restaurantService.searchPage({ cuisines: [] });

    expect(mocked.rpc.mock.calls[0][1]).toMatchObject({ p_cuisines: null });
  });

  it('defaults to the recommended sort', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    await restaurantService.searchPage({});

    expect(mocked.rpc.mock.calls[0][1]).toMatchObject({ p_sort: 'Recommended' });
  });

  it('never fetches the whole catalogue to search it', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    await restaurantService.searchPage({ search: 'pizza' });

    expect(mocked.from).not.toHaveBeenCalled();
  });
});

describe('restaurant search pagination', () => {
  it('offers a next offset while a full page comes back', async () => {
    mocked.rpc.mockReturnValue(rpcResult(makeRestaurants(20)));

    const page = await restaurantService.searchPage({}, 0);

    expect(page.nextOffset).toBe(20);
  });

  it('stops paging on a short page', async () => {
    mocked.rpc.mockReturnValue(rpcResult(makeRestaurants(7)));

    const page = await restaurantService.searchPage({}, 20);

    expect(page.nextOffset).toBeNull();
  });

  it('asks for the requested offset', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    await restaurantService.searchPage({}, 40);

    expect(mocked.rpc.mock.calls[0][1]).toMatchObject({ p_offset: 40, p_limit: 20 });
  });

  it('surfaces a failed search instead of returning an empty list', async () => {
    mocked.rpc.mockReturnValue(Promise.resolve({ data: null, error: new Error('boom') }));

    await expect(restaurantService.searchPage({ search: 'pizza' })).rejects.toThrow('boom');
  });
});

describe('dish search', () => {
  it('queries the server for a real term', async () => {
    mocked.rpc.mockReturnValue(rpcResult([{ id: 'dish-1', name: 'Ramen' }]));

    const result = await menuService.searchDishes('ramen');

    expect(mocked.rpc).toHaveBeenCalledWith('search_dishes', {
      p_search: 'ramen',
      p_limit: 20,
      p_offset: 0,
    });
    expect(result.dishes).toHaveLength(1);
  });

  it('short circuits an empty query without hitting the network', async () => {
    const result = await menuService.searchDishes('   ');

    expect(mocked.rpc).not.toHaveBeenCalled();
    expect(result).toEqual({ dishes: [], nextOffset: null });
  });

  it('propagates a dish search failure', async () => {
    mocked.rpc.mockReturnValue(Promise.resolve({ data: null, error: new Error('offline') }));

    await expect(menuService.searchDishes('ramen')).rejects.toThrow('offline');
  });
});

describe('cuisine list', () => {
  it('reads distinct cuisines from the server, not from every restaurant row', async () => {
    mocked.rpc.mockReturnValue(
      rpcResult([{ cuisine: 'Italian' }, { cuisine: 'Japanese' }])
    );

    const cuisines = await restaurantService.getDistinctCuisines();

    expect(mocked.rpc).toHaveBeenCalledWith('distinct_cuisines');
    expect(cuisines).toEqual(['Italian', 'Japanese']);
    expect(mocked.from).not.toHaveBeenCalled();
  });
});
