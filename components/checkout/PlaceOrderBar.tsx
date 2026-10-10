import { PurchaseButton } from '@/components/buttons/PurchaseButton';
import type { CheckoutSubmission } from '@/hooks/useCheckout';

export interface PlaceOrderBarProps {
  submission: CheckoutSubmission;
}

export const PlaceOrderBar = ({ submission }: PlaceOrderBarProps) => (
  <PurchaseButton
    onPress={submission.place}
    deliveryTimeSelected={submission.deliveryTimeSelected}
    disabled={!submission.canPlace || submission.isBusy}
    isSubmitting={submission.isBusy}
    label={submission.label}
  />
);
