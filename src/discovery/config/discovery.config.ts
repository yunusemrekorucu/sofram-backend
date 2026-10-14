import { registerAs } from '@nestjs/config';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import validateConfig from '../../utils/validate-config';
import { DiscoveryConfig } from './discovery-config.type';

class EnvironmentVariablesValidator {
  @IsNumber()
  @Min(0.1)
  @Max(50)
  @IsOptional()
  DISCOVERY_PICKUP_RADIUS_KM: number;

  @IsInt()
  @Min(0)
  @Max(6)
  @IsOptional()
  DISCOVERY_COORD_PRECISION: number;
}

export default registerAs<DiscoveryConfig>('discovery', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    pickupRadiusKm: process.env.DISCOVERY_PICKUP_RADIUS_KM
      ? Number(process.env.DISCOVERY_PICKUP_RADIUS_KM)
      : 5,
    coordPrecision: process.env.DISCOVERY_COORD_PRECISION
      ? parseInt(process.env.DISCOVERY_COORD_PRECISION, 10)
      : 3,
  };
});
