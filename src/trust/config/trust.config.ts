import { registerAs } from '@nestjs/config';
import { IsEmail, IsInt, IsOptional, Max, Min } from 'class-validator';
import validateConfig from '../../utils/validate-config';
import { TrustConfig } from './trust-config.type';

class EnvironmentVariablesValidator {
  @IsInt()
  @Min(1)
  @Max(90)
  @IsOptional()
  REVIEW_WINDOW_DAYS: number;

  @IsInt()
  @Min(1)
  @Max(720)
  @IsOptional()
  ISSUE_WINDOW_HOURS: number;

  @IsInt()
  @Min(1)
  @Max(720)
  @IsOptional()
  MESSAGING_WINDOW_HOURS: number;

  @IsEmail()
  SUPPORT_EMAIL: string;
}

export default registerAs<TrustConfig>('trust', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    reviewWindowDays: process.env.REVIEW_WINDOW_DAYS
      ? parseInt(process.env.REVIEW_WINDOW_DAYS, 10)
      : 7,
    issueWindowHours: process.env.ISSUE_WINDOW_HOURS
      ? parseInt(process.env.ISSUE_WINDOW_HOURS, 10)
      : 48,
    messagingWindowHours: process.env.MESSAGING_WINDOW_HOURS
      ? parseInt(process.env.MESSAGING_WINDOW_HOURS, 10)
      : 24,
    supportEmail: process.env.SUPPORT_EMAIL as string,
  };
});
