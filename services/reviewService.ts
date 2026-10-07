import { supabase } from '@/lib/supabase';
import type {
  ManagedReview,
  MyReview,
  PublicReview,
  Review,
  ReviewEligibility,
  ReviewResponse,
  ReviewStatus,
  ReviewSummary,
} from '@/types/database';

export const REVIEW_PAGE_SIZE = 20;
export const REVIEW_BODY_MAX_LENGTH = 1000;

export interface ReviewPage {
  reviews: PublicReview[];
  nextOffset: number | null;
}

export const reviewService = {
  eligibility: async (orderId: string): Promise<ReviewEligibility> => {
    const { data, error } = await supabase.rpc('review_eligibility', { p_order_id: orderId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return (row ?? {
      can_review: false,
      reason: 'not_found',
      review_id: null,
    }) as ReviewEligibility;
  },

  listForRestaurant: async (
    restaurantId: string,
    offset = 0,
    limit = REVIEW_PAGE_SIZE
  ): Promise<ReviewPage> => {
    const { data, error } = await supabase.rpc('restaurant_reviews', {
      p_restaurant_id: restaurantId,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;

    const reviews = (data ?? []) as PublicReview[];
    return {
      reviews,
      nextOffset: reviews.length < limit ? null : offset + reviews.length,
    };
  },

  summary: async (restaurantId: string): Promise<ReviewSummary> => {
    const { data, error } = await supabase.rpc('restaurant_review_summary', {
      p_restaurant_id: restaurantId,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return (row ?? {
      review_count: 0,
      average_rating: 0,
      rating_breakdown: {},
    }) as ReviewSummary;
  },

  mine: async (offset = 0, limit = REVIEW_PAGE_SIZE): Promise<MyReview[]> => {
    const { data, error } = await supabase.rpc('my_reviews', {
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;
    return (data ?? []) as MyReview[];
  },

  listForManagement: async (
    restaurantId: string | null,
    offset = 0,
    limit = REVIEW_PAGE_SIZE
  ): Promise<ManagedReview[]> => {
    const { data, error } = await supabase.rpc('manage_reviews', {
      p_restaurant_id: restaurantId,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;
    return (data ?? []) as ManagedReview[];
  },

  submit: async (orderId: string, rating: number, body?: string | null): Promise<Review> => {
    const { data, error } = await supabase.rpc('submit_review', {
      p_order_id: orderId,
      p_rating: rating,
      p_body: body ?? null,
    });
    if (error) throw error;
    return data as Review;
  },

  update: async (reviewId: string, rating: number, body?: string | null): Promise<Review> => {
    const { data, error } = await supabase.rpc('update_review', {
      p_review_id: reviewId,
      p_rating: rating,
      p_body: body ?? null,
    });
    if (error) throw error;
    return data as Review;
  },

  remove: async (reviewId: string): Promise<void> => {
    const { error } = await supabase.rpc('delete_review', { p_review_id: reviewId });
    if (error) throw error;
  },

  respond: async (reviewId: string, body: string): Promise<ReviewResponse> => {
    const { data, error } = await supabase.rpc('respond_to_review', {
      p_review_id: reviewId,
      p_body: body,
    });
    if (error) throw error;
    return data as ReviewResponse;
  },

  moderate: async (reviewId: string, status: ReviewStatus, reason?: string): Promise<Review> => {
    const { data, error } = await supabase.rpc('moderate_review', {
      p_review_id: reviewId,
      p_status: status,
      p_reason: reason ?? null,
    });
    if (error) throw error;
    return data as Review;
  },
};
