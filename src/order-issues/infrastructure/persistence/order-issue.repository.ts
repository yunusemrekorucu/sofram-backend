import { Order } from '../../../orders/domain/order';
import { IssueStatus } from '../../../trust/trust.enums';
import { NullableType } from '../../../utils/types/nullable.type';
import {
  NewOrderIssue,
  OrderIssue,
  OrderIssueResolution,
} from '../../domain/order-issue';

export type IssuePage = { offset: number; limit: number };

/** What the admin needs of the order next to its issue. */
export type IssueOrder = Pick<
  Order,
  'id' | 'code' | 'kitchenId' | 'totalKurus'
>;

export type OrderIssueWithOrder = { issue: OrderIssue; order: IssueOrder };

/** The order already has an open report (partial unique index). */
export class DuplicateOpenIssueError extends Error {}

export abstract class OrderIssueRepository {
  /** Inserts an open report; DuplicateOpenIssueError when one is already open. */
  abstract create(issue: NewOrderIssue): Promise<OrderIssue>;

  abstract findById(id: OrderIssue['id']): Promise<NullableType<OrderIssue>>;

  abstract hasOpen(orderId: Order['id']): Promise<boolean>;

  /** Newest first; every status when `status` is undefined. */
  abstract list(
    status: IssueStatus | undefined,
    page: IssuePage,
  ): Promise<OrderIssueWithOrder[]>;

  /**
   * One transaction with the issue row locked: null unless it is still open;
   * otherwise `beforeClose` runs (the refund — its error rolls back and the
   * issue stays open), then `resolution` is written.
   */
  abstract resolve(
    id: OrderIssue['id'],
    resolution: OrderIssueResolution,
    beforeClose: (issue: OrderIssue) => Promise<void>,
  ): Promise<NullableType<OrderIssueWithOrder>>;
}
