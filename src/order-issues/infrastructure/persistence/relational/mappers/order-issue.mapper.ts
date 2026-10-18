import { toFileType, toSnapshot } from '../../../../../catalog/file-snapshot';
import { IssueStatus } from '../../../../../trust/trust.enums';
import { NewOrderIssue, OrderIssue } from '../../../../domain/order-issue';
import { OrderIssueEntity } from '../entities/order-issue.entity';

export class OrderIssueMapper {
  static toDomain(raw: OrderIssueEntity): OrderIssue {
    return Object.assign(new OrderIssue(), {
      id: raw.id,
      orderId: raw.orderId,
      reporterId: raw.reporterId,
      category: raw.category,
      description: raw.description,
      photos: raw.photos.map(toFileType),
      requestedResolution: raw.requestedResolution,
      status: raw.status,
      refundKurus: raw.refundKurus,
      adminNote: raw.adminNote,
      resolvedAt: raw.resolvedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  /** A new report is always open. */
  static toPersistence(issue: NewOrderIssue): OrderIssueEntity {
    return Object.assign(new OrderIssueEntity(), {
      ...issue,
      reporterId: Number(issue.reporterId),
      photos: issue.photos.map(toSnapshot),
      status: IssueStatus.open,
    });
  }
}
