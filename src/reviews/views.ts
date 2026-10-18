import { ApiProperty } from '@nestjs/swagger';
import { FileType } from '../files/domain/file';
import { ReviewReportReason, ReviewTag } from '../trust/trust.enums';

const STAR = { type: Number, minimum: 1, maximum: 5 };

/** The customer's own review: POST /orders/:id/review and `review` of an order. */
export class OrderReviewView {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty(STAR)
  rating: number;

  @ApiProperty({ ...STAR, nullable: true })
  taste: number | null;

  @ApiProperty({ ...STAR, nullable: true })
  portion: number | null;

  @ApiProperty({ ...STAR, nullable: true })
  packaging: number | null;

  @ApiProperty({ ...STAR, nullable: true })
  timing: number | null;

  @ApiProperty({ enum: ReviewTag, isArray: true })
  tags: ReviewTag[];

  @ApiProperty({ type: String, nullable: true })
  comment: string | null;

  @ApiProperty({ type: () => FileType, isArray: true })
  photos: FileType[];

  @ApiProperty({ type: String, nullable: true, description: 'Aşçı yanıtı' })
  reply: string | null;

  @ApiProperty({ type: Date, nullable: true })
  repliedAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

/** GET /discover/kitchens/:id/reviews */
export class ReviewView extends OrderReviewView {
  @ApiProperty({ type: String, nullable: true, description: 'Ad S.' })
  authorName: string | null;

  @ApiProperty({ type: () => FileType, nullable: true })
  authorPhoto: FileType | null;
}

/** The cook's list (hidden ones labelled) and the admin's. */
export class KitchenReviewView extends ReviewView {
  @ApiProperty({ type: String })
  orderId: string;

  @ApiProperty({ type: String })
  kitchenId: string;

  @ApiProperty({ type: Boolean, description: 'Admin gizledi ("Gizlendi")' })
  isHidden: boolean;
}

export class RatingDistributionView {
  @ApiProperty({ type: Number })
  '1': number;

  @ApiProperty({ type: Number })
  '2': number;

  @ApiProperty({ type: Number })
  '3': number;

  @ApiProperty({ type: Number })
  '4': number;

  @ApiProperty({ type: Number })
  '5': number;
}

export class ReviewsSummaryView {
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Tek ondalık; değerlendirme yoksa null ("Yeni")',
  })
  ratingAvg: number | null;

  @ApiProperty({ type: Number })
  ratingCount: number;

  @ApiProperty({ type: () => RatingDistributionView })
  distribution: RatingDistributionView;

  @ApiProperty({
    enum: ReviewTag,
    isArray: true,
    description: 'En sık seçilen en çok 3 etiket',
  })
  topTags: ReviewTag[];
}

/** GET /discover/kitchens/:id/reviews — an infinite list plus the summary. */
export class KitchenReviewsPage {
  @ApiProperty({ type: () => ReviewView, isArray: true })
  data: ReviewView[];

  @ApiProperty({ type: Boolean })
  hasNextPage: boolean;

  @ApiProperty({ type: () => ReviewsSummaryView })
  summary: ReviewsSummaryView;
}

/** GET /admin/review-reports */
export class ReviewReportView {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ enum: ReviewReportReason })
  reason: ReviewReportReason;

  @ApiProperty({ type: String, nullable: true })
  note: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: () => KitchenReviewView })
  review: KitchenReviewView;
}
