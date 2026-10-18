import { registerAs } from '@nestjs/config';
import { IsBooleanString, IsIn, IsOptional } from 'class-validator';
import validateConfig from '../../utils/validate-config';
import { PaymentsConfig } from './payments-config.type';

class EnvironmentVariablesValidator {
  @IsIn(['dev'])
  @IsOptional()
  PAYMENT_PROVIDER: string;

  @IsBooleanString()
  @IsOptional()
  DEV_PAYMENT_FAIL: string;
}

export default registerAs<PaymentsConfig>('payments', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    provider: 'dev',
    devPaymentFail: process.env.DEV_PAYMENT_FAIL === 'true',
  };
});
