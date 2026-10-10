import { supabase } from '@/lib/supabase';
import type { CartItem } from '@/hooks/use-cartstore';
import type { CartValidation, CartValidationLine } from '@/types/database';

export interface CartValidationRequestItem {
  dish_id: string;
  quantity: number;
  addon_ids: string[];
  unit_price: number;
}

export const toValidationItems = (items: CartItem[]): CartValidationRequestItem[] =>
  items.map((item) => ({
    dish_id: item.dish.id,
    quantity: item.quantity,
    addon_ids: item.selectedAddons.map((addon) => addon.id),
    unit_price: item.unitPrice,
  }));

export const cartValidationService = {
  validate: async (restaurantId: string, items: CartItem[]): Promise<CartValidation> => {
    const { data, error } = await supabase.rpc('validate_cart', {
      p_restaurant_id: restaurantId,
      p_items: toValidationItems(items),
    });
    if (error) throw error;

    const row = (Array.isArray(data) ? data[0] : data) as CartValidation | undefined;
    if (!row) throw new Error('We could not check your basket.');

    return { ...row, lines: row.lines ?? [] };
  },
};

export const lineKeyOf = (line: CartValidationLine): string =>
  `${line.dish_id}::${[...line.missing_addon_ids].sort().join(',')}`;

export const isLineRemoved = (line: CartValidationLine): boolean =>
  !line.dish_found || !line.is_available;

export const removedLines = (validation: CartValidation): CartValidationLine[] =>
  validation.lines.filter(isLineRemoved);

export const repricedLines = (validation: CartValidation): CartValidationLine[] =>
  validation.lines.filter((line) => !isLineRemoved(line) && line.price_changed);

export const linesWithMissingAddons = (validation: CartValidation): CartValidationLine[] =>
  validation.lines.filter((line) => !isLineRemoved(line) && line.missing_addon_ids.length > 0);

export const describeCartChanges = (validation: CartValidation | undefined): string[] => {
  if (!validation) return [];

  const notices: string[] = [];
  const removed = removedLines(validation);
  const repriced = repricedLines(validation);

  removed.forEach((line) => {
    notices.push(`${line.dish_name ?? 'An item'} is no longer available`);
  });

  if (repriced.length > 0) {
    notices.push(repriced.length === 1 ? 'A price changed' : 'Prices changed');
  }

  linesWithMissingAddons(validation).forEach((line) => {
    notices.push(`An extra on ${line.dish_name ?? 'an item'} is no longer offered`);
  });

  if (!validation.is_open) {
    notices.push(`${validation.restaurant_name} is closed right now`);
  }

  if (validation.lines.length > 0 && !validation.meets_min_order) {
    notices.push(
      `The minimum order is ${Number(validation.min_order).toFixed(2)} ${validation.currency}`
    );
  }

  return notices;
};

export const needsAcknowledgement = (validation: CartValidation | undefined): boolean =>
  !!validation && validation.has_changes;
