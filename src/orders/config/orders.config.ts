import { registerAs } from '@nestjs/config';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import validateConfig from '../../utils/validate-config';
import { OrdersConfig } from './orders-config.type';

class EnvironmentVariablesValidator {
  @IsInt()
  @Min(1)
  @Max(60)
  @IsOptional()
  ORDER_ACCEPT_MINUTES: number;

  @IsInt()
  @Min(0)
  @Max(240)
  @IsOptional()
  ORDER_DELIVERY_BUFFER_MINUTES: number;

  @IsNumber()
  @Min(0)
  @Max(50)
  @IsOptional()
  ORDER_SERVICE_FEE_PERCENT: number;
}

export default registerAs<OrdersConfig>('orders', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    acceptMinutes: process.env.ORDER_ACCEPT_MINUTES
      ? parseInt(process.env.ORDER_ACCEPT_MINUTES, 10)
      : 3,
    deliveryBufferMinutes: process.env.ORDER_DELIVERY_BUFFER_MINUTES
      ? parseInt(process.env.ORDER_DELIVERY_BUFFER_MINUTES, 10)
      : 15,
    serviceFeePercent: process.env.ORDER_SERVICE_FEE_PERCENT
      ? Number(process.env.ORDER_SERVICE_FEE_PERCENT)
      : 5,
  };
});
