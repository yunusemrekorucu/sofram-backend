import { IntersectionType } from '@nestjs/swagger';
import { PointQueryDto } from '../../discovery/dto/discover-query.dto';
import { PageQueryDto } from '../../orders/dto/list-orders.dto';

/** GET /favorites — the selected address measures the distances, like /discover. */
export class ListFavoritesQueryDto extends IntersectionType(
  PointQueryDto,
  PageQueryDto,
) {}
