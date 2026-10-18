import { FileType } from '../../files/domain/file';
import { Order } from '../../orders/domain/order';
import {
  IssueCategory,
  IssueResolution,
  IssueStatus,
} from '../../trust/trust.enums';
import { User } from '../../users/domain/user';

/** A customer's report of a problem with an order; kept when the account goes. */
export class OrderIssue {
  id: string;

  orderId: Order['id'];

  reporterId: User['id'];

  category: IssueCategory;

  description: string;

  photos: FileType[];

  requestedResolution: IssueResolution;

  status: IssueStatus;

  /** The refund applied when it was resolved. */
  refundKurus: number | null;

  /** Shown to the customer and the cook. */
  adminNote: string | null;

  resolvedAt: Date | null;

  createdAt: Date;

  updatedAt: Date;
}

export type NewOrderIssue = Pick<
  OrderIssue,
  | 'orderId'
  | 'reporterId'
  | 'category'
  | 'description'
  | 'photos'
  | 'requestedResolution'
>;

/** What an admin's decision writes. */
export type OrderIssueResolution = Pick<
  OrderIssue,
  'status' | 'refundKurus' | 'adminNote' | 'resolvedAt'
>;
