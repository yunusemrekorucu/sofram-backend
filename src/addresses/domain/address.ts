import { User } from '../../users/domain/user';
import { Exclude } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class Address {
  @Exclude({ toPlainOnly: true })
  user?: User;

  @ApiProperty({
    type: () => Boolean,
    nullable: false,
  })
  isDefault?: boolean;

  @ApiProperty({
    type: () => Number,
    nullable: false,
  })
  longitude: number;

  @ApiProperty({
    type: () => Number,
    nullable: false,
  })
  latitude: number;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  directions?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  apartmentNo?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  floor?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  buildingNo?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  neighborhood: string;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  district: string;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  fullAddress: string;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  title: string;

  @ApiProperty({
    type: String,
  })
  id: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
