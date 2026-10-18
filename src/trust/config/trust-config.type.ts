export type TrustConfig = {
  /** A completed order can be reviewed for this many days. */
  reviewWindowDays: number;
  /** An issue can be reported this many hours after the order closed. */
  issueWindowHours: number;
  /** The order chat stays writable this many hours after the order closed. */
  messagingWindowHours: number;
  /** New issue reports are mailed here (maildev in development). */
  supportEmail: string;
};
