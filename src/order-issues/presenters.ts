import { OrderIssue } from './domain/order-issue';
import { OrderIssueWithOrder } from './infrastructure/persistence/order-issue.repository';
import { AdminIssueView, IssueSummaryView, IssueView } from './views';

const summaryFields = (issue: OrderIssue) => ({
  id: issue.id,
  category: issue.category,
  requestedResolution: issue.requestedResolution,
  status: issue.status,
  refundKurus: issue.refundKurus,
  adminNote: issue.adminNote,
  createdAt: issue.createdAt,
  resolvedAt: issue.resolvedAt,
});

export const issueSummaryView = (issue: OrderIssue): IssueSummaryView =>
  Object.assign(new IssueSummaryView(), summaryFields(issue));

export const issueView = (issue: OrderIssue): IssueView =>
  Object.assign(new IssueView(), summaryFields(issue), {
    description: issue.description,
    photos: issue.photos,
  });

export const adminIssueView = ({
  issue,
  order,
}: OrderIssueWithOrder): AdminIssueView =>
  Object.assign(new AdminIssueView(), issueView(issue), { order });
