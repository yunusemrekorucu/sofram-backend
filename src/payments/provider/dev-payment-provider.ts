import { randomUUID } from 'crypto';
import {
  ChargeRequest,
  ChargeResult,
  PaymentDeclinedError,
  PaymentProvider,
} from './payment-provider';

/** Moves no money. Declines every charge while `fail` is on (DEV_PAYMENT_FAIL). */
export class DevPaymentProvider extends PaymentProvider {
  readonly name = 'dev';

  constructor(private readonly fail: boolean) {
    super();
  }

  charge(request: ChargeRequest): Promise<ChargeResult> {
    if (this.fail) {
      return Promise.reject(
        new PaymentDeclinedError(
          `DEV_PAYMENT_FAIL declined order ${request.orderId}`,
        ),
      );
    }

    return Promise.resolve({ providerRef: `dev_${randomUUID()}` });
  }

  refund(): Promise<void> {
    return Promise.resolve();
  }
}
