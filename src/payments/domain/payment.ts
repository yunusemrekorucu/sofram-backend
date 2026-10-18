export enum PaymentStatus {
  paid = 'paid',
  refunded = 'refunded',
  refundFailed = 'refund_failed',
  /** Reserved for asynchronous providers; a declined charge rolls the order back and stores nothing. */
  failed = 'failed',
}

/** One per order: the charge taken when it was placed and, later, its refund. */
export class Payment {
  id: string;

  orderId: string;

  /** `dev` until a real provider exists (Faz 5). */
  provider: string;

  providerRef: string;

  amountKurus: number;

  /** Given back so far; a full refund sets it to amountKurus, partial refunds add up to it. */
  refundedKurus: number;

  status: PaymentStatus;

  paidAt: Date | null;

  refundedAt: Date | null;

  createdAt: Date;

  updatedAt: Date;
}

export type NewPayment = Omit<
  Payment,
  'id' | 'refundedKurus' | 'createdAt' | 'updatedAt'
>;
