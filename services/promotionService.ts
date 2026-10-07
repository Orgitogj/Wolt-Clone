import { supabase } from '@/lib/supabase';
import type {
  AdminPromotion,
  DiscountType,
  Promotion,
  PromotionEvaluation,
  PromotionRejectionReason,
} from '@/types/database';

export interface PromotionDraft {
  id?: string | null;
  code: string;
  description?: string | null;
  discountType: DiscountType;
  discountValue: number;
  maxDiscount?: number | null;
  minSubtotal?: number;
  restaurantId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  maxRedemptions?: number | null;
  maxPerCustomer?: number;
  isActive?: boolean;
}

export const PROMOTION_MESSAGES: Record<PromotionRejectionReason, string> = {
  eligible: 'Promo code applied',
  not_found: 'We do not recognise that promo code',
  not_signed_in: 'Sign in to use a promo code',
  not_started: 'That promo code is not active yet',
  expired: 'That promo code has expired',
  wrong_restaurant: 'That promo code does not apply to this restaurant',
  below_minimum: 'Your basket is below the minimum for that code',
  fully_redeemed: 'That promo code has been fully redeemed',
  already_used: 'You have already used that promo code',
};

export const promotionService = {
  evaluate: async (
    code: string,
    restaurantId: string,
    subtotal: number
  ): Promise<PromotionEvaluation> => {
    const { data, error } = await supabase.rpc('evaluate_promotion', {
      p_code: code,
      p_restaurant_id: restaurantId,
      p_subtotal: subtotal,
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    return (row ?? {
      valid: false,
      reason: 'not_found',
      discount_amount: 0,
      promotion_id: null,
      description: null,
    }) as PromotionEvaluation;
  },

  listActive: async (restaurantId?: string | null): Promise<Promotion[]> => {
    const { data, error } = await supabase.rpc('active_promotions', {
      p_restaurant_id: restaurantId ?? null,
    });
    if (error) throw error;
    return (data ?? []) as Promotion[];
  },

  listForAdmin: async (): Promise<AdminPromotion[]> => {
    const { data, error } = await supabase.rpc('admin_promotions');
    if (error) throw error;
    return (data ?? []) as AdminPromotion[];
  },

  save: async (draft: PromotionDraft): Promise<Promotion> => {
    const { data, error } = await supabase.rpc('admin_save_promotion', {
      p_id: draft.id ?? null,
      p_code: draft.code,
      p_description: draft.description ?? null,
      p_discount_type: draft.discountType,
      p_discount_value: draft.discountValue,
      p_max_discount: draft.maxDiscount ?? null,
      p_min_subtotal: draft.minSubtotal ?? 0,
      p_restaurant_id: draft.restaurantId ?? null,
      p_starts_at: draft.startsAt ?? null,
      p_ends_at: draft.endsAt ?? null,
      p_max_redemptions: draft.maxRedemptions ?? null,
      p_max_per_customer: draft.maxPerCustomer ?? 1,
      p_is_active: draft.isActive ?? true,
    });
    if (error) throw error;
    return data as Promotion;
  },

  setActive: async (id: string, isActive: boolean): Promise<Promotion> => {
    const { data, error } = await supabase.rpc('admin_set_promotion_active', {
      p_id: id,
      p_is_active: isActive,
    });
    if (error) throw error;
    return data as Promotion;
  },
};

export const describePromotion = (promotion: Promotion): string => {
  const value =
    promotion.discount_type === 'percentage'
      ? `${Number(promotion.discount_value)}% off`
      : `${Number(promotion.discount_value).toFixed(2)} € off`;

  const terms: string[] = [];
  if (promotion.min_subtotal > 0) {
    terms.push(`over ${Number(promotion.min_subtotal).toFixed(2)} €`);
  }
  if (promotion.discount_type === 'percentage' && promotion.max_discount) {
    terms.push(`up to ${Number(promotion.max_discount).toFixed(2)} €`);
  }

  return terms.length ? `${value} ${terms.join(', ')}` : value;
};
