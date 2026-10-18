import { ApiProperty } from '@nestjs/swagger';
import { FileType } from '../files/domain/file';
import {
  IssueCategory,
  IssueResolution,
  IssueStatus,
} from '../trust/trust.enums';

/** `issue` of an order (customer and cook): the latest report, read-only. */
export class IssueSummaryView {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ enum: IssueCategory })
  category: IssueCategory;

  @ApiProperty({ enum: IssueResolution })
  requestedResolution: IssueResolution;

  @ApiProperty({ enum: IssueStatus })
  status: IssueStatus;

  @ApiProperty({ type: Number, nullable: true, description: 'kuruş' })
  refundKurus: number | null;

  @ApiProperty({ type: String, nullable: true })
  adminNote: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  resolvedAt: Date | null;
}

/** POST /orders/:id/issues */
export class IssueView extends IssueSummaryView {
  @ApiProperty({ type: String })
  description: string;

  @ApiProperty({ type: () => FileType, isArray: true })
  photos: FileType[];
}

export class IssueOrderView {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, example: 'S-7K3F' })
  code: string;

  @ApiProperty({ type: String })
  kitchenId: string;

  @ApiProperty({ type: Number, description: 'kuruş' })
  totalKurus: number;
}

/** GET/PATCH /admin/issues */
export class AdminIssueView extends IssueView {
  @ApiProperty({ type: () => IssueOrderView })
  order: IssueOrderView;
}
