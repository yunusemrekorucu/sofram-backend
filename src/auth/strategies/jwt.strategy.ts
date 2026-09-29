import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { OrNeverType } from '../../utils/types/or-never.type';
import { JwtPayloadType } from './types/jwt-payload.type';
import { AllConfigType } from '../../config/config.type';
import { SessionService } from '../../session/session.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService<AllConfigType>,
    private readonly sessionService: SessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.getOrThrow('auth.secret', { infer: true }),
      algorithms: ['HS256'],
    });
  }

  // The boilerplate keeps access tokens stateless and skips the database here
  // (https://github.com/brocoders/nestjs-boilerplate/blob/main/docs/auth.md#about-jwt-strategy).
  // We look the session up instead: logout and account deletion delete
  // sessions, and without this check their access tokens would keep working
  // until they expire. One primary-key lookup per request is the price.
  public async validate(
    payload: JwtPayloadType,
  ): Promise<OrNeverType<JwtPayloadType>> {
    if (!payload.id || !payload.sessionId) {
      throw new UnauthorizedException();
    }

    const session = await this.sessionService.findById(payload.sessionId);

    if (!session || String(session.user?.id) !== String(payload.id)) {
      throw new UnauthorizedException();
    }

    return payload;
  }
}
