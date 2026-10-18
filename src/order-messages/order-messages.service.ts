import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { KitchensService } from '../kitchens/kitchens.service';
import { Order } from '../orders/domain/order';
import { OrderRepository } from '../orders/infrastructure/persistence/order.repository';
import { messagingClosed } from '../trust/trust-errors';
import { canMessage, unreadRule } from '../trust/trust-rules';
import { MessageSide } from '../trust/trust.enums';
import { User } from '../users/domain/user';
import { orNotFound } from '../utils/or-not-found';
import { OrderMessage } from './domain/order-message';
import { OrderMessageRepository } from './infrastructure/persistence/order-message.repository';
import { OrderMessageView, OrderMessagesView } from './views';

/** One poll returns at most this many messages. */
export const MESSAGE_PAGE = 100;

const messageView = (message: OrderMessage): OrderMessageView =>
  Object.assign(new OrderMessageView(), {
    id: message.id,
    senderRole: message.senderRole,
    body: message.body,
    createdAt: message.createdAt,
  });

/**
 * The order chat. The order decides who may take part: its customer, and the
 * cook of its kitchen — anyone else gets a 404. Never a phone number.
 */
@Injectable()
export class OrderMessagesService {
  constructor(
    private readonly messageRepository: OrderMessageRepository,
    private readonly orderRepository: OrderRepository,
    private readonly kitchensService: KitchensService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async readAsCustomer(
    customerId: User['id'],
    orderId: Order['id'],
    after: string | undefined,
  ): Promise<OrderMessagesView> {
    const order = await this.customerOrder(customerId, orderId);
    return this.read(order, MessageSide.customer, after);
  }

  async sendAsCustomer(
    customerId: User['id'],
    orderId: Order['id'],
    body: string,
  ): Promise<OrderMessageView> {
    const order = await this.customerOrder(customerId, orderId);
    return this.send(order, customerId, MessageSide.customer, body);
  }

  async readAsCook(
    ownerId: User['id'],
    orderId: Order['id'],
    after: string | undefined,
  ): Promise<OrderMessagesView> {
    const order = await this.cookOrder(ownerId, orderId);
    return this.read(order, MessageSide.cook, after);
  }

  async sendAsCook(
    ownerId: User['id'],
    orderId: Order['id'],
    body: string,
  ): Promise<OrderMessageView> {
    const order = await this.cookOrder(ownerId, orderId);
    return this.send(order, ownerId, MessageSide.cook, body);
  }

  /** Account deletion: the user's messages are hard-deleted (the other side's stay). */
  removeAllForUser(userId: User['id']): Promise<void> {
    return this.messageRepository.removeAllBySender(userId);
  }

  /** Moves the reader's marker to now, then returns the messages. */
  private async read(
    order: Order,
    side: MessageSide,
    after: string | undefined,
  ): Promise<OrderMessagesView> {
    const now = new Date();
    await this.orderRepository.markRead(
      order.id,
      unreadRule(side).readMarker,
      now,
    );
    const messages = await this.messageRepository.list(
      order.id,
      after ? new Date(after) : null,
      MESSAGE_PAGE,
    );

    return Object.assign(new OrderMessagesView(), {
      data: messages.map(messageView),
      canMessage: canMessage(order, now, this.windowHours()),
    });
  }

  /** 409 messagingClosed once the window after closing is over. */
  private async send(
    order: Order,
    senderId: User['id'],
    side: MessageSide,
    body: string,
  ): Promise<OrderMessageView> {
    if (!canMessage(order, new Date(), this.windowHours())) {
      throw messagingClosed();
    }

    return messageView(
      await this.messageRepository.create({
        orderId: order.id,
        senderId,
        senderRole: side,
        body,
      }),
    );
  }

  private customerOrder(
    customerId: User['id'],
    orderId: Order['id'],
  ): Promise<Order> {
    return orNotFound(
      this.orderRepository.findForCustomer(customerId, orderId),
    );
  }

  private async cookOrder(
    ownerId: User['id'],
    orderId: Order['id'],
  ): Promise<Order> {
    const kitchen = await this.kitchensService.findMine(ownerId);
    return orNotFound(this.orderRepository.findForKitchen(kitchen.id, orderId));
  }

  private windowHours(): number {
    return this.configService.getOrThrow('trust.messagingWindowHours', {
      infer: true,
    });
  }
}
