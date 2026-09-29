import { ApiProperty } from '@nestjs/swagger';
import { LoginResponseDto } from './login-response.dto';

export class PhoneLoginResponseDto extends LoginResponseDto {
  @ApiProperty({
    description: 'true: bu numara ilk kez görüldü, kullanıcı yeni oluşturuldu',
  })
  isNewUser: boolean;
}
