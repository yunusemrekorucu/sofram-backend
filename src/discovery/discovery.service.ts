import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { likePattern } from '../catalog/fold-turkish';
import { haversineKm, roundCoord } from '../catalog/geo';
import { istanbulClock } from '../catalog/opening-state';
import { AllConfigType } from '../config/config.type';
import { Kitchen } from '../kitchens/domain/kitchen';
import { User } from '../users/domain/user';
import { UsersService } from '../users/users.service';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { infinityPagination } from '../utils/infinity-pagination';
import { orNotFound } from '../utils/or-not-found';
import { DiscoveryFilter, DiscoveryRepository } from './discovery.repository';
import { DiscoverQueryDto, PointQueryDto } from './dto/discover-query.dto';
import {
  ViewerContext,
  kitchenCard,
  kitchenDetail,
  productCard,
  productDetail,
} from './presenters';
import {
  KitchenCard,
  KitchenDetail,
  ProductCard,
  ProductDetail,
} from './views';
import { isKitchenReachable, isProductListed } from './visibility';

const notFound = () =>
  new NotFoundException({ status: HttpStatus.NOT_FOUND, error: 'notFound' });

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly discoveryRepository: DiscoveryRepository,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async kitchens(
    userId: User['id'],
    query: DiscoverQueryDto,
  ): Promise<InfinityPaginationResponseDto<KitchenCard>> {
    const ctx = await this.context(userId, query);
    const hits = await this.discoveryRepository.findKitchens(
      this.filter(ctx, query),
    );

    return infinityPagination(
      hits.map((hit) => kitchenCard(hit.kitchen, hit.distanceKm, ctx)),
      { page: query.page, limit: query.limit },
    );
  }

  async products(
    userId: User['id'],
    query: DiscoverQueryDto,
  ): Promise<InfinityPaginationResponseDto<ProductCard>> {
    const ctx = await this.context(userId, query);
    const hits = await this.discoveryRepository.findProducts(
      this.filter(ctx, query),
    );

    return infinityPagination(
      hits.map((hit) =>
        productCard(hit.product, hit.kitchen, hit.distanceKm, ctx),
      ),
      { page: query.page, limit: query.limit },
    );
  }

  /** Out of reach is a 404 — except for the kitchen's own cook. */
  async kitchen(
    userId: User['id'],
    id: Kitchen['id'],
    point: PointQueryDto,
  ): Promise<KitchenDetail> {
    const ctx = await this.context(userId, point);
    const kitchen = await orNotFound(
      this.discoveryRepository.findKitchenById(id),
    );
    const distanceKm = this.distanceTo(kitchen, ctx);

    if (
      !this.isOwner(kitchen, ctx) &&
      !isKitchenReachable(kitchen, distanceKm, ctx.pickupRadiusKm)
    ) {
      throw notFound();
    }

    const products = await this.discoveryRepository.findListedProductsOfKitchen(
      kitchen.id,
    );

    return kitchenDetail(kitchen, distanceKm, products, ctx);
  }

  async product(
    userId: User['id'],
    id: string,
    point: PointQueryDto,
  ): Promise<ProductDetail> {
    const ctx = await this.context(userId, point);
    const { product, kitchen } = await orNotFound(
      this.discoveryRepository.findProductById(id),
    );
    const distanceKm = this.distanceTo(kitchen, ctx);
    const visible =
      isKitchenReachable(kitchen, distanceKm, ctx.pickupRadiusKm) &&
      isProductListed(product);

    if (!this.isOwner(kitchen, ctx) && !visible) {
      throw notFound();
    }

    return productDetail(product, kitchen, distanceKm, ctx);
  }

  /** Measured to the rounded point, so probing cannot recover the exact one. */
  private distanceTo(kitchen: Kitchen, ctx: ViewerContext): number {
    return haversineKm(ctx.point, {
      latitude: roundCoord(kitchen.latitude, ctx.coordPrecision),
      longitude: roundCoord(kitchen.longitude, ctx.coordPrecision),
    });
  }

  private isOwner(kitchen: Kitchen, ctx: ViewerContext): boolean {
    return String(kitchen.ownerId) === String(ctx.userId);
  }

  private async context(
    userId: User['id'],
    point: PointQueryDto,
  ): Promise<ViewerContext> {
    const user = await this.usersService.findById(userId);

    return {
      userId,
      allergenPreferences: user?.allergenPreferences ?? [],
      point: { latitude: point.lat, longitude: point.lng },
      pickupRadiusKm: this.configService.getOrThrow(
        'discovery.pickupRadiusKm',
        { infer: true },
      ),
      coordPrecision: this.configService.getOrThrow(
        'discovery.coordPrecision',
        { infer: true },
      ),
      now: new Date(),
    };
  }

  private filter(ctx: ViewerContext, query: DiscoverQueryDto): DiscoveryFilter {
    return {
      point: ctx.point,
      pickupRadiusKm: ctx.pickupRadiusKm,
      coordPrecision: ctx.coordPrecision,
      clock: istanbulClock(ctx.now),
      categoryId: query.categoryId,
      diet: query.diet,
      excludeAllergens: query.allergenSafe ? ctx.allergenPreferences : [],
      query: query.q ? likePattern(query.q) : undefined,
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
    };
  }
}
