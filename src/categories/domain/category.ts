import { ApiProperty } from '@nestjs/swagger';

export class Category {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, example: 'soup' })
  slug: string;

  @ApiProperty({ type: String, example: 'Çorba' })
  nameTr: string;

  @ApiProperty({ type: String, example: 'Soup' })
  nameEn: string;

  @ApiProperty({ type: String, nullable: true, example: 'soup' })
  icon: string | null;

  @ApiProperty({ type: Number })
  sortOrder: number;

  @ApiProperty({ type: Boolean })
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
