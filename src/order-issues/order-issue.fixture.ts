import {
  IssueCategory,
  IssueResolution,
  IssueStatus,
} from '../trust/trust.enums';
import { OrderIssue } from './domain/order-issue';

/** Unit-test fixture for the order-issue specs. */
export const anIssue = (overrides: Partial<OrderIssue> = {}): OrderIssue =>
  Object.assign(new OrderIssue(), {
    id: 'is1',
    orderId: 'o1',
    reporterId: 9,
    category: IssueCategory.missingItem,
    description: 'Sütlaç paketten çıkmadı',
    photos: [],
    requestedResolution: IssueResolution.refundPartial,
    status: IssueStatus.open,
    refundKurus: null,
    adminNote: null,
    resolvedAt: null,
    createdAt: new Date('2026-10-12T12:00:00Z'),
    updatedAt: new Date('2026-10-12T12:00:00Z'),
    ...overrides,
  });
