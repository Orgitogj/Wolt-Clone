import type {
  CourierDocumentKind,
  CourierVehicleType,
  DeliveryStatus,
  VerificationStatus,
} from '@/types/database';

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: 'Finding a courier',
  assigned: 'Heading to restaurant',
  picked_up: 'Picked up',
  delivering: 'On the way to you',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  pending: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
};

export const VEHICLE_LABELS: Record<CourierVehicleType, string> = {
  bicycle: 'Bicycle',
  scooter: 'Scooter',
  car: 'Car',
  on_foot: 'On foot',
};

export const VEHICLE_OPTIONS: CourierVehicleType[] = ['bicycle', 'scooter', 'car', 'on_foot'];

export const DOCUMENT_LABELS: Record<CourierDocumentKind, string> = {
  id_card: 'ID card',
  drivers_license: 'Driving licence',
  insurance: 'Insurance',
  vehicle_registration: 'Vehicle registration',
};

export const REQUIRED_DOCUMENTS: Record<CourierVehicleType, CourierDocumentKind[]> = {
  bicycle: ['id_card'],
  on_foot: ['id_card'],
  scooter: ['id_card', 'drivers_license', 'insurance', 'vehicle_registration'],
  car: ['id_card', 'drivers_license', 'insurance', 'vehicle_registration'],
};

export interface CourierStep {
  to: DeliveryStatus;
  label: string;
  hint: string;
}

export const COURIER_NEXT_STEP: Partial<Record<DeliveryStatus, CourierStep>> = {
  assigned: {
    to: 'picked_up',
    label: 'Confirm pickup',
    hint: 'Collect the order from the restaurant',
  },
  picked_up: {
    to: 'delivering',
    label: 'Start delivery',
    hint: 'Head to the customer address',
  },
  delivering: {
    to: 'delivered',
    label: 'Confirm delivery',
    hint: 'Hand the order to the customer',
  },
};

export const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ['assigned', 'picked_up', 'delivering'];

export const LOCATION_UPDATE_DISTANCE_M = 50;
export const LOCATION_UPDATE_INTERVAL_MS = 15000;
export const DISPATCH_TICK_MS = 10000;
