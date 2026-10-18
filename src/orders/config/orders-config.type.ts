export type OrdersConfig = {
  /** A pending order expires after this many minutes without an answer. */
  acceptMinutes: number;
  /** Added to the prep time of delivery orders. */
  deliveryBufferMinutes: number;
  /** Platform fee on the subtotal, paid by the customer. */
  serviceFeePercent: number;
};
