export type PaymentsConfig = {
  /** PAYMENT_PROVIDER; only `dev` exists until Faz 5. */
  provider: 'dev';
  /** DEV_PAYMENT_FAIL: the dev provider declines every charge. Ignored in production. */
  devPaymentFail: boolean;
};
