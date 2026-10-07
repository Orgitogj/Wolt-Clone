jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

import { RatingStars } from '@/components/reviews/RatingStars';
import { ReviewCard } from '@/components/reviews/ReviewCard';
import { supabase } from '@/lib/supabase';
import { reviewService } from '@/services/reviewService';
import type { PublicReview } from '@/types/database';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { SupabaseMock } from './helpers/supabase';

const mocked = supabase as unknown as SupabaseMock;

const rpcResult = (data: unknown) => Promise.resolve({ data, error: null });

const publicReview = (overrides: Partial<PublicReview> = {}): PublicReview => ({
  id: 'review-1',
  rating: 4,
  body: 'Great food',
  created_at: '2026-01-01T12:00:00.000Z',
  updated_at: '2026-01-01T12:00:00.000Z',
  reviewer_name: 'Ada',
  is_mine: false,
  response_body: null,
  response_created_at: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('eligibility', () => {
  it('asks the server whether an order can be reviewed', async () => {
    mocked.rpc.mockReturnValue(
      rpcResult([{ can_review: true, reason: 'eligible', review_id: null }])
    );

    const result = await reviewService.eligibility('order-1');

    expect(mocked.rpc).toHaveBeenCalledWith('review_eligibility', { p_order_id: 'order-1' });
    expect(result.can_review).toBe(true);
  });

  it('treats a missing row as not eligible rather than as allowed', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    const result = await reviewService.eligibility('order-1');

    expect(result.can_review).toBe(false);
    expect(result.reason).toBe('not_found');
  });

  it('surfaces an eligibility failure instead of allowing a review', async () => {
    mocked.rpc.mockReturnValue(Promise.resolve({ data: null, error: new Error('offline') }));

    await expect(reviewService.eligibility('order-1')).rejects.toThrow('offline');
  });
});

describe('submitting', () => {
  it('sends the order id, rating and body to the server function', async () => {
    mocked.rpc.mockReturnValue(rpcResult({ id: 'review-1', rating: 5 }));

    await reviewService.submit('order-1', 5, 'Lovely');

    expect(mocked.rpc).toHaveBeenCalledWith('submit_review', {
      p_order_id: 'order-1',
      p_rating: 5,
      p_body: 'Lovely',
    });
  });

  it('sends a null body when no text was written', async () => {
    mocked.rpc.mockReturnValue(rpcResult({ id: 'review-1' }));

    await reviewService.submit('order-1', 5);

    expect(mocked.rpc.mock.calls[0][1]).toMatchObject({ p_body: null });
  });

  it('never sends a restaurant rating or review count from the client', async () => {
    mocked.rpc.mockReturnValue(rpcResult({ id: 'review-1' }));

    await reviewService.submit('order-1', 5, 'Lovely');

    const payload = JSON.stringify(mocked.rpc.mock.calls[0][1]);
    expect(payload).not.toContain('rating_average');
    expect(payload).not.toContain('review_count');
    expect(mocked.from).not.toHaveBeenCalled();
  });

  it('propagates a duplicate submission error', async () => {
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: null, error: new Error('You have already reviewed this order') })
    );

    await expect(reviewService.submit('order-1', 5)).rejects.toThrow('already reviewed');
  });

  it('propagates a rejected rating', async () => {
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: null, error: new Error('Rating must be between 1 and 5') })
    );

    await expect(reviewService.submit('order-1', 9)).rejects.toThrow('between 1 and 5');
  });
});

describe('editing and deleting', () => {
  it('updates through the server function', async () => {
    mocked.rpc.mockReturnValue(rpcResult({ id: 'review-1', rating: 3 }));

    await reviewService.update('review-1', 3, 'Changed my mind');

    expect(mocked.rpc).toHaveBeenCalledWith('update_review', {
      p_review_id: 'review-1',
      p_rating: 3,
      p_body: 'Changed my mind',
    });
  });

  it('deletes through the server function', async () => {
    mocked.rpc.mockReturnValue(rpcResult(null));

    await reviewService.remove('review-1');

    expect(mocked.rpc).toHaveBeenCalledWith('delete_review', { p_review_id: 'review-1' });
  });

  it('never writes to the reviews table directly', async () => {
    mocked.rpc.mockReturnValue(rpcResult({ id: 'review-1' }));

    await reviewService.update('review-1', 3, 'text');
    await reviewService.remove('review-1');

    expect(mocked.from).not.toHaveBeenCalled();
  });
});

describe('responses and moderation', () => {
  it('sends a merchant response through the server function', async () => {
    mocked.rpc.mockReturnValue(rpcResult({ review_id: 'review-1', body: 'Thanks' }));

    await reviewService.respond('review-1', 'Thanks');

    expect(mocked.rpc).toHaveBeenCalledWith('respond_to_review', {
      p_review_id: 'review-1',
      p_body: 'Thanks',
    });
  });

  it('sends moderation with a status and reason', async () => {
    mocked.rpc.mockReturnValue(rpcResult({ id: 'review-1', status: 'hidden' }));

    await reviewService.moderate('review-1', 'hidden', 'Abusive');

    expect(mocked.rpc).toHaveBeenCalledWith('moderate_review', {
      p_review_id: 'review-1',
      p_status: 'hidden',
      p_reason: 'Abusive',
    });
  });

  it('propagates a refused moderation attempt', async () => {
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: null, error: new Error('Administrator access is required') })
    );

    await expect(reviewService.moderate('review-1', 'hidden')).rejects.toThrow(
      'Administrator access is required'
    );
  });

  it('propagates a refused response attempt', async () => {
    mocked.rpc.mockReturnValue(
      Promise.resolve({
        data: null,
        error: new Error('Only the restaurant can respond to this review'),
      })
    );

    await expect(reviewService.respond('review-1', 'hi')).rejects.toThrow(
      'Only the restaurant can respond'
    );
  });
});

describe('listing', () => {
  it('pages the public review list', async () => {
    mocked.rpc.mockReturnValue(rpcResult(Array.from({ length: 20 }, () => publicReview())));

    const page = await reviewService.listForRestaurant('restaurant-1', 0);

    expect(mocked.rpc).toHaveBeenCalledWith('restaurant_reviews', {
      p_restaurant_id: 'restaurant-1',
      p_limit: 20,
      p_offset: 0,
    });
    expect(page.nextOffset).toBe(20);
  });

  it('stops paging on a short page', async () => {
    mocked.rpc.mockReturnValue(rpcResult([publicReview()]));

    const page = await reviewService.listForRestaurant('restaurant-1', 20);

    expect(page.nextOffset).toBeNull();
  });

  it('defaults an empty summary rather than throwing', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    const summary = await reviewService.summary('restaurant-1');

    expect(summary).toEqual({ review_count: 0, average_rating: 0, rating_breakdown: {} });
  });
});

describe('rating input', () => {
  it('reports the chosen rating', () => {
    const onChange = jest.fn();
    render(<RatingStars rating={0} onChange={onChange} />);

    fireEvent.press(screen.getByTestId('rating-star-4'));

    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('does not accept input while disabled', () => {
    const onChange = jest.fn();
    render(<RatingStars rating={0} onChange={onChange} disabled />);

    fireEvent.press(screen.getByTestId('rating-star-3'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('is read only when no handler is given', () => {
    render(<RatingStars rating={3} testID="read-only-stars" />);

    expect(screen.queryByTestId('rating-star-3')).toBeNull();
    expect(screen.getByTestId('read-only-stars')).toBeTruthy();
  });
});

describe('review card', () => {
  it('shows the reviewer name, body and response', () => {
    render(
      <ReviewCard
        review={publicReview({ response_body: 'Thanks for visiting', body: 'Great food' })}
      />
    );

    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('Great food')).toBeTruthy();
    expect(screen.getByText('Thanks for visiting')).toBeTruthy();
  });

  it('marks the reader own review', () => {
    render(<ReviewCard review={publicReview({ is_mine: true })} />);

    expect(screen.getByText('Your review')).toBeTruthy();
  });

  it('renders a rating only review without a body', () => {
    render(<ReviewCard review={publicReview({ body: null })} />);

    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.queryByText('Great food')).toBeNull();
  });
});
