import useAuthStore from '@/hooks/use-auth-store';
import { useCartContents, useCartStore } from '@/hooks/use-cartstore';
import {
  cartValidationService,
  describeCartChanges,
  needsAcknowledgement,
} from '@/services/cartValidationService';
import type { CartValidation } from '@/types/database';
import { currentSessionEpoch, isStaleSession } from '@/utils/sessionGuard';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface CartValidationState {
  validation: CartValidation | undefined;
  notices: string[];
  isChecking: boolean;
  error: unknown;
  needsReview: boolean;
  isAcknowledged: boolean;
  acknowledge: () => void;
  updateCart: () => void;
  recheck: () => void;
}

export const useCartValidation = (enabled = true): CartValidationState => {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const { items, selectedRestaurant, isRestored } = useCartContents();
  const applyValidation = useCartStore((state) => state.applyValidation);
  const queryClient = useQueryClient();
  const [acknowledgedAt, setAcknowledgedAt] = useState<string | null>(null);

  const restaurantId = selectedRestaurant?.id;
  const signature = useMemo(
    () =>
      items
        .map(
          (item) =>
            `${item.dish.id}:${item.quantity}:${item.unitPrice}:${item.selectedAddons
              .map((addon) => addon.id)
              .sort()
              .join('+')}`
        )
        .join('|'),
    [items]
  );

  const scoped = enabled && isRestored && !!restaurantId && !!userId && items.length > 0;

  const query = useQuery({
    queryKey: ['cart-validation', restaurantId, userId, signature],
    queryFn: () => cartValidationService.validate(restaurantId!, items),
    enabled: scoped,
    staleTime: 0,
    gcTime: 0,
  });

  const validation = query.data;
  const needsReview = needsAcknowledgement(validation);

  useEffect(() => {
    setAcknowledgedAt(null);
  }, [signature, restaurantId, userId]);

  const notices = useMemo(() => describeCartChanges(validation), [validation]);

  const acknowledge = useCallback(() => {
    setAcknowledgedAt(signature);
  }, [signature]);

  const recheck = useCallback(() => {
    if (!scoped) return;
    void queryClient.invalidateQueries({ queryKey: ['cart-validation', restaurantId, userId] });
  }, [scoped, queryClient, restaurantId, userId]);

  const updateCart = useCallback(() => {
    if (!validation) return;
    const epoch = currentSessionEpoch();
    applyValidation(validation);
    if (isStaleSession(epoch)) return;
    setAcknowledgedAt(null);
  }, [validation, applyValidation]);

  return {
    validation,
    notices,
    isChecking: query.isLoading || query.isFetching,
    error: query.error,
    needsReview,
    isAcknowledged: acknowledgedAt === signature,
    acknowledge,
    updateCart,
    recheck,
  };
};
