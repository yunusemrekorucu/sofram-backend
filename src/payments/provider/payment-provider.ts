export type ChargeRequest = { orderId: string; amountKurus: number };

export type ChargeResult = { providerRef: string };

export type RefundRequest = { providerRef: string; amountKurus: number };

/** The provider said no; the order is not placed. */
export class PaymentDeclinedError extends Error {}

/**
 * Takes and returns money for an order. Faz 3 ships only the dev provider; a
 * marketplace provider (sub-merchant onboarding) plugs in here in Faz 5.
 */
export abstract class PaymentProvider {
  /** Stored on the payment row (`payment.provider`). */
  abstract readonly name: string;

  /** Resolves with the provider's reference or rejects with PaymentDeclinedError. */
  abstract charge(request: ChargeRequest): Promise<ChargeResult>;

  /** Rejects when the provider refuses the refund. */
  abstract refund(request: RefundRequest): Promise<void>;
}
