import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  SerializeOptions,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../auth/auth.service';
import { AuthPhoneLoginDto } from './dto/auth-phone-login.dto';
import { PhoneLoginResponseDto } from '../auth/dto/phone-login-response.dto';
import { PhoneTokenVerifier } from './verifier/phone-token-verifier';

@ApiTags('Auth')
@Controller({
  path: 'auth/phone',
  version: '1',
})
export class AuthPhoneController {
  constructor(
    private readonly authService: AuthService,
    private readonly phoneTokenVerifier: PhoneTokenVerifier,
  ) {}

  @ApiOkResponse({
    type: PhoneLoginResponseDto,
  })
  @SerializeOptions({
    groups: ['me'],
  })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: AuthPhoneLoginDto,
  ): Promise<PhoneLoginResponseDto> {
    const { phoneNumber } = await this.phoneTokenVerifier.verify(
      loginDto.idToken,
    );

    return this.authService.validatePhoneLogin(phoneNumber);
  }
}
