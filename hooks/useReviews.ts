import useAuthStore from '@/hooks/use-auth-store';
import { REVIEW_PAGE_SIZE, reviewService } from '@/services/reviewService';
import type { ReviewStatus } from '@/types/database';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

export const useRestaurantReviews = (restaurantId: string) => {
  const query = useInfiniteQuery({
    queryKey: ['reviews', restaurantId],
    queryFn: ({ pageParam }) => reviewService.listForRestaurant(restaurantId, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: !!restaurantId,
  });

  const reviews = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.reviews),
    [query.data]
  );

  return { ...query, reviews, pageSize: REVIEW_PAGE_SIZE };
};

export const useReviewSummary = (restaurantId: string) =>
  useQuery({
    queryKey: ['review-summary', restaurantId],
    queryFn: () => reviewService.summary(restaurantId),
    enabled: !!restaurantId,
  });

export const useReviewEligibility = (orderId: string | undefined) => {
  const { user } = useAuthStore();

  return useQuery({
    queryKey: ['review-eligibility', orderId, user?.id],
    queryFn: () => reviewService.eligibility(orderId!),
    enabled: !!orderId && !!user?.id,
  });
};

export const useMyReviews = () => {
  const { user } = useAuthStore();

  return useQuery({
    queryKey: ['my-reviews', user?.id],
    queryFn: () => reviewService.mine(),
    enabled: !!user?.id,
  });
};

export const useManagedReviews = (restaurantId: string | null, enabled = true) =>
  useQuery({
    queryKey: ['managed-reviews', restaurantId],
    queryFn: () => reviewService.listForManagement(restaurantId),
    enabled,
  });

const useReviewInvalidation = (restaurantId?: string) => {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: ['reviews', restaurantId] });
    queryClient.invalidateQueries({ queryKey: ['review-summary', restaurantId] });
    queryClient.invalidateQueries({ queryKey: ['review-eligibility'] });
    queryClient.invalidateQueries({ queryKey: ['my-reviews'] });
    queryClient.invalidateQueries({ queryKey: ['managed-reviews'] });
    queryClient.invalidateQueries({ queryKey: ['restaurant', restaurantId] });
  };
};

export const useSubmitReview = (restaurantId?: string) => {
  const invalidate = useReviewInvalidation(restaurantId);

  return useMutation({
    mutationFn: ({
      orderId,
      rating,
      body,
    }: {
      orderId: string;
      rating: number;
      body?: string | null;
    }) => reviewService.submit(orderId, rating, body),
    onSuccess: invalidate,
  });
};

export const useUpdateReview = (restaurantId?: string) => {
  const invalidate = useReviewInvalidation(restaurantId);

  return useMutation({
    mutationFn: ({
      reviewId,
      rating,
      body,
    }: {
      reviewId: string;
      rating: number;
      body?: string | null;
    }) => reviewService.update(reviewId, rating, body),
    onSuccess: invalidate,
  });
};

export const useDeleteReview = (restaurantId?: string) => {
  const invalidate = useReviewInvalidation(restaurantId);

  return useMutation({
    mutationFn: (reviewId: string) => reviewService.remove(reviewId),
    onSuccess: invalidate,
  });
};

export const useRespondToReview = (restaurantId?: string) => {
  const invalidate = useReviewInvalidation(restaurantId);

  return useMutation({
    mutationFn: ({ reviewId, body }: { reviewId: string; body: string }) =>
      reviewService.respond(reviewId, body),
    onSuccess: invalidate,
  });
};

export const useModerateReview = (restaurantId?: string) => {
  const invalidate = useReviewInvalidation(restaurantId);

  return useMutation({
    mutationFn: ({
      reviewId,
      status,
      reason,
    }: {
      reviewId: string;
      status: ReviewStatus;
      reason?: string;
    }) => reviewService.moderate(reviewId, status, reason),
    onSuccess: invalidate,
  });
};
