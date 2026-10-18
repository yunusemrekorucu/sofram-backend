import { Kitchen } from '../../../kitchens/domain/kitchen';
import { Order } from '../../../orders/domain/order';
import { MessageSide } from '../../../trust/trust.enums';
import { User } from '../../../users/domain/user';
import { NewOrderMessage, OrderMessage } from '../../domain/order-message';

export abstract class OrderMessageRepository {
  abstract create(message: NewOrderMessage): Promise<OrderMessage>;

  /** Oldest first; only those written after `after` when given. */
  abstract list(
    orderId: Order['id'],
    after: Date | null,
    limit: number,
  ): Promise<OrderMessage[]>;

  /** Unread per order for `viewer` (unreadRule); orders without any are left out. */
  abstract countUnread(
    orderIds: Order['id'][],
    viewer: MessageSide,
  ): Promise<Map<Order['id'], number>>;

  /** Account deletion: everything the user wrote, as either side. */
  abstract removeAllBySender(senderId: User['id']): Promise<void>;

  /** Customers' messages the cook has not read, over every order of the kitchen. */
  abstract countUnreadForKitchen(kitchenId: Kitchen['id']): Promise<number>;
}
