import { promotionService, type PromotionDraft } from '@/services/promotionService';
import type { PromotionEvaluation } from '@/types/database';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

export const useActivePromotions = (restaurantId?: string | null) =>
  useQuery({
    queryKey: ['promotions', 'active', restaurantId ?? null],
    queryFn: () => promotionService.listActive(restaurantId),
  });

export const useAdminPromotions = () =>
  useQuery({
    queryKey: ['promotions', 'admin'],
    queryFn: promotionService.listForAdmin,
  });

export const useSavePromotion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (draft: PromotionDraft) => promotionService.save(draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promotions'] }),
  });
};

export const useSetPromotionActive = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      promotionService.setActive(id, isActive),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promotions'] }),
  });
};

export interface AppliedPromotion {
  code: string;
  discountAmount: number;
  description: string | null;
}

export const usePromoCode = (restaurantId: string | undefined, subtotal: number) => {
  const [applied, setApplied] = useState<AppliedPromotion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const clear = useCallback(() => {
    setApplied(null);
    setError(null);
  }, []);

  const apply = useCallback(
    async (code: string): Promise<PromotionEvaluation | null> => {
      const trimmed = code.trim();
      if (!trimmed || !restaurantId) return null;

      setIsChecking(true);
      setError(null);

      try {
        const evaluation = await promotionService.evaluate(trimmed, restaurantId, subtotal);

        if (evaluation.valid) {
          setApplied({
            code: trimmed.toUpperCase(),
            discountAmount: Number(evaluation.discount_amount),
            description: evaluation.description,
          });
        } else {
          setApplied(null);
        }

        return evaluation;
      } catch (evaluationError) {
        setApplied(null);
        setError(
          evaluationError instanceof Error
            ? 'We could not check that code. Please try again.'
            : 'We could not check that code.'
        );
        return null;
      } finally {
        setIsChecking(false);
      }
    },
    [restaurantId, subtotal]
  );

  return { applied, error, isChecking, apply, clear, setError };
};
