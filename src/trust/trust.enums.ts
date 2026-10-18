/** Quick tags a customer may pick for a review (0–3). */
export enum ReviewTag {
  homemade = 'homemade',
  generousPortion = 'generous_portion',
  arrivedHot = 'arrived_hot',
  wellPackaged = 'well_packaged',
  onTime = 'on_time',
  friendlyCook = 'friendly_cook',
}

/** Why a cook reports a review; the review stays visible until an admin hides it. */
export enum ReviewReportReason {
  offensive = 'offensive',
  falseClaim = 'false_claim',
  notMyOrder = 'not_my_order',
  other = 'other',
}

/** The cook's review list (GET /kitchens/me/reviews?filter=). */
export enum ReviewFilter {
  all = 'all',
  unreplied = 'unreplied',
}

export enum IssueCategory {
  missingItem = 'missing_item',
  wrongItem = 'wrong_item',
  qualityHygiene = 'quality_hygiene',
  late = 'late',
  healthIssue = 'health_issue',
  other = 'other',
}

/** What the customer asks for when reporting an issue. */
export enum IssueResolution {
  refundFull = 'refund_full',
  refundPartial = 'refund_partial',
  none = 'none',
}

export enum IssueStatus {
  open = 'open',
  resolved = 'resolved',
  rejected = 'rejected',
}

/** The two parties of an order's chat. */
export enum MessageSide {
  customer = 'customer',
  cook = 'cook',
}
