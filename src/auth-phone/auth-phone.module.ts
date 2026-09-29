import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { AuthPhoneController } from './auth-phone.controller';
import { phoneTokenVerifierProvider } from './verifier/phone-token-verifier.provider';

@Module({
  imports: [ConfigModule, AuthModule],
  providers: [phoneTokenVerifierProvider],
  controllers: [AuthPhoneController],
})
export class AuthPhoneModule {}
