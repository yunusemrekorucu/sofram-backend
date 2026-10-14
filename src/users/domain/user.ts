import { Exclude, Expose } from 'class-transformer';
import { FileType } from '../../files/domain/file';
import { Role } from '../../roles/domain/role';
import { Status } from '../../statuses/domain/status';
import { ApiProperty } from '@nestjs/swagger';
import { Allergen } from '../../catalog/catalog.enums';

const idType = Number;

export class User {
  @ApiProperty({ enum: Allergen, isArray: true })
  allergenPreferences?: Allergen[];

  /** Derived per request (AuthService); never stored. */
  @ApiProperty({ type: Boolean })
  hasKitchen?: boolean;

  @ApiProperty({
    type: () => Boolean,
    nullable: false,
  })
  @Expose({ groups: ['me', 'admin'] })
  marketingConsent?: boolean;

  /** Proof of consent — admins only; users see it as `profileCompleted`. */
  @ApiProperty({
    type: () => Date,
    nullable: true,
  })
  @Expose({ groups: ['admin'] })
  kvkkAcceptedAt?: Date | null;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  @Expose({ groups: ['me', 'admin'] })
  phoneNumber?: string | null;

  @ApiProperty({
    type: idType,
  })
  id: number | string;

  @ApiProperty({
    type: String,
    example: 'john.doe@example.com',
  })
  @Expose({ groups: ['me', 'admin'] })
  email: string | null;

  @Exclude({ toPlainOnly: true })
  password?: string;

  @ApiProperty({
    type: String,
    example: 'email',
  })
  @Expose({ groups: ['me', 'admin'] })
  provider: string;

  @ApiProperty({
    type: String,
    example: '1234567890',
  })
  @Expose({ groups: ['me', 'admin'] })
  socialId?: string | null;

  @ApiProperty({
    type: String,
    example: 'John',
  })
  firstName: string | null;

  @ApiProperty({
    type: String,
    example: 'Doe',
  })
  lastName: string | null;

  /** Derived in UserMapper.toDomain — never persisted. */
  @ApiProperty({ type: Boolean })
  profileCompleted?: boolean;

  @ApiProperty({
    type: () => FileType,
  })
  photo?: FileType | null;

  @ApiProperty({
    type: () => Role,
  })
  role?: Role | null;

  @ApiProperty({
    type: () => Status,
  })
  status?: Status;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty()
  deletedAt: Date;
}
