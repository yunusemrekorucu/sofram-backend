import { FileType } from '../../files/domain/file';
import { Kitchen } from '../../kitchens/domain/kitchen';
import { User } from '../../users/domain/user';
import {
  CancelledBy,
  Fulfillment,
  OrderReason,
  OrderStatus,
} from '../order.enums';
import { OrderItem } from './order-item';

/** A copy of the address-book entry; kept when the entry is deleted. */
export type DeliveryAddress = {
  fullAddress: string;
  district: string;
  neighborhood: string;
  buildingNo: string | null;
  floor: string | null;
  apartmentNo: string | null;
  directions: string | null;
  latitude: number;
  longitude: number;
};

export type PersonName = { firstName: string | null; lastName: string | null };

/** The kitchen side, read with every order (soft-deleted kitchens included). */
export type OrderKitchen = Pick<
  Kitchen,
  | 'id'
  | 'ownerId'
  | 'name'
  | 'coverPhoto'
  | 'district'
  | 'fullAddress'
  | 'latitude'
  | 'longitude'
> & { cook: PersonName & { photo: FileType | null } };

export class Order {
  id: string;

  /** `S-7K3F` */
  code: string;

  customerId: User['id'];

  kitchenId: Kitchen['id'];

  status: OrderStatus;

  fulfillment: Fulfillment;

  /** Delivery only; cleared when the customer deletes the account. */
  deliveryAddress: DeliveryAddress | null;

  distanceKm: number | null;

  note: string | null;

  subtotalKurus: number;

  deliveryFeeKurus: number;

  serviceFeeKurus: number;

  totalKurus: number;

  /** Pickup only; never shown to the cook. */
  pickupCode: string | null;

  expiresAt: Date;

  estimatedReadyAt: Date | null;

  acceptedAt: Date | null;

  preparingAt: Date | null;

  readyAt: Date | null;

  onTheWayAt: Date | null;

  completedAt: Date | null;

  /** Rejected, cancelled or expired. */
  closedAt: Date | null;

  cancelledBy: CancelledBy | null;

  reason: OrderReason | null;

  /** Chat read markers: the side's unread messages are the other side's after it. */
  customerLastReadAt: Date | null;

  cookLastReadAt: Date | null;

  /** In cart order. */
  items: OrderItem[];

  kitchen: OrderKitchen;

  customer: PersonName;

  createdAt: Date;

  updatedAt: Date;
}

export type NewOrderItem = Omit<OrderItem, 'id'>;

/** What OrderRepository.place inserts; the repository picks the code. */
export type NewOrder = Omit<
  Order,
  | 'id'
  | 'code'
  | 'items'
  | 'kitchen'
  | 'customer'
  | 'customerLastReadAt'
  | 'cookLastReadAt'
  | 'createdAt'
  | 'updatedAt'
> & { items: NewOrderItem[] };

/** What a status change may write. */
export type OrderPatch = Partial<
  Pick<
    Order,
    | 'status'
    | 'estimatedReadyAt'
    | 'acceptedAt'
    | 'preparingAt'
    | 'readyAt'
    | 'onTheWayAt'
    | 'completedAt'
    | 'closedAt'
    | 'cancelledBy'
    | 'reason'
  >
>;
