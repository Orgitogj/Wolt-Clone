import { menuService } from '@/services/menuService';
import { restaurantService } from '@/services/restaurantService';
import type {
  Dish,
  OrderItem,
  OrderWithItems,
  Restaurant,
  SelectedAddon,
} from '@/types/database';

export type ReorderIssueReason =
  | 'dish_removed'
  | 'dish_unavailable'
  | 'addon_removed'
  | 'addon_price_changed';

export interface ReorderIssue {
  name: string;
  reason: ReorderIssueReason;
  detail?: string;
}

export interface ReorderPriceChange {
  name: string;
  previousUnitPrice: number;
  currentUnitPrice: number;
}

export interface ReorderLine {
  dish: Dish;
  addons: SelectedAddon[];
  quantity: number;
  unitPrice: number;
}

export interface ReorderPlan {
  restaurant: Restaurant | null;
  restaurantAvailable: boolean;
  restaurantOpen: boolean;
  lines: ReorderLine[];
  issues: ReorderIssue[];
  priceChanges: ReorderPriceChange[];
  subtotal: number;
  canReorder: boolean;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export const buildReorderPlan = (
  orderItems: OrderItem[],
  restaurant: Restaurant | null,
  dishes: Dish[]
): ReorderPlan => {
  const lines: ReorderLine[] = [];
  const issues: ReorderIssue[] = [];
  const priceChanges: ReorderPriceChange[] = [];

  const dishById = new Map(dishes.map((dish) => [dish.id, dish]));

  orderItems.forEach((item) => {
    const dish = item.dish_id ? dishById.get(item.dish_id) : undefined;

    if (!dish) {
      issues.push({ name: item.dish_name, reason: 'dish_removed' });
      return;
    }

    if (!dish.is_available) {
      issues.push({ name: dish.name, reason: 'dish_unavailable' });
      return;
    }

    const availableAddons = dish.addons ?? [];
    const keptAddons: SelectedAddon[] = [];

    (item.addons ?? []).forEach((previousAddon) => {
      const current = availableAddons.find((addon) => addon.id === previousAddon.id);

      if (!current) {
        issues.push({
          name: dish.name,
          reason: 'addon_removed',
          detail: previousAddon.name,
        });
        return;
      }

      keptAddons.push({
        id: current.id,
        name: current.name,
        priceDelta: Number(current.price_delta),
      });

      if (Number(current.price_delta) !== Number(previousAddon.priceDelta)) {
        issues.push({
          name: dish.name,
          reason: 'addon_price_changed',
          detail: current.name,
        });
      }
    });

    const unitPrice = round2(
      Number(dish.price) + keptAddons.reduce((sum, addon) => sum + addon.priceDelta, 0)
    );

    if (unitPrice !== round2(Number(item.unit_price))) {
      priceChanges.push({
        name: dish.name,
        previousUnitPrice: round2(Number(item.unit_price)),
        currentUnitPrice: unitPrice,
      });
    }

    lines.push({ dish, addons: keptAddons, quantity: item.quantity, unitPrice });
  });

  const subtotal = round2(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
  const restaurantAvailable = !!restaurant;
  const restaurantOpen = !!restaurant?.is_open;

  return {
    restaurant: restaurant ?? null,
    restaurantAvailable,
    restaurantOpen,
    lines,
    issues,
    priceChanges,
    subtotal,
    canReorder: restaurantAvailable && restaurantOpen && lines.length > 0,
  };
};

export const reorderService = {
  planFor: async (order: OrderWithItems): Promise<ReorderPlan> => {
    const [restaurant, dishes] = await Promise.all([
      restaurantService.getById(order.restaurant_id),
      menuService.listDishesWithAddons(order.restaurant_id),
    ]);

    return buildReorderPlan(order.order_items ?? [], restaurant ?? null, dishes);
  },
};

export const describeReorderIssue = (issue: ReorderIssue): string => {
  switch (issue.reason) {
    case 'dish_removed':
      return `${issue.name} is no longer on the menu`;
    case 'dish_unavailable':
      return `${issue.name} is sold out right now`;
    case 'addon_removed':
      return `${issue.detail} is no longer available on ${issue.name}`;
    case 'addon_price_changed':
      return `${issue.detail} on ${issue.name} has a new price`;
    default:
      return issue.name;
  }
};
