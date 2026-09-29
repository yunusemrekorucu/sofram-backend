export type ApiFieldError = { field: string; message: string };

export type ApiEnvelope<T> = {
  data: T;
  status: boolean;
  statusCode: number;
  message: string;
  errors?: ApiFieldError[];
};
