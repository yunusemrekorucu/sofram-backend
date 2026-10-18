import { Order } from '../../orders/domain/order';
import { MessageSide } from '../../trust/trust.enums';
import { User } from '../../users/domain/user';

/** A line of an order's chat between the customer and the cook. */
export class OrderMessage {
  id: string;

  orderId: Order['id'];

  senderId: User['id'];

  senderRole: MessageSide;

  body: string;

  createdAt: Date;
}

export type NewOrderMessage = Pick<
  OrderMessage,
  'orderId' | 'senderId' | 'senderRole' | 'body'
>;
