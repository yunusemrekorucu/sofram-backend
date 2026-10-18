import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../orders/dto/list-orders.dto';
import { IssueStatus } from '../../trust/trust.enums';

/** GET /admin/issues */
export class ListOrderIssuesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: IssueStatus })
  @IsOptional()
  @IsEnum(IssueStatus)
  status?: IssueStatus;
}

/** PATCH /admin/issues/:id */
export class ResolveOrderIssueDto {
  @ApiProperty({ enum: [IssueStatus.resolved, IssueStatus.rejected] })
  @IsIn([IssueStatus.resolved, IssueStatus.rejected])
  status: IssueStatus.resolved | IssueStatus.rejected;

  @ApiPropertyOptional({
    description: 'Yalnız resolved: kısmi/tam iade, kuruş',
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  refundKurus?: number;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 500,
    description: 'Müşteriye ve aşçıya görünür',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  adminNote?: string | null;
}
