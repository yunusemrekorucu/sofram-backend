import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { kitchenCard, roundedDistanceKm } from '../discovery/presenters';
import { KitchenCard } from '../discovery/views';
import { Kitchen } from '../kitchens/domain/kitchen';
import { KitchensService } from '../kitchens/kitchens.service';
import { User } from '../users/domain/user';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { infinityPagination } from '../utils/infinity-pagination';
import { orNotFound } from '../utils/or-not-found';
import { ListFavoritesQueryDto } from './dto/list-favorites.dto';
import { FavoriteRepository } from './infrastructure/persistence/favorite.repository';

/** Kitchens a customer follows; only kitchens, never products. */
@Injectable()
export class FavoritesService {
  constructor(
    private readonly favoriteRepository: FavoriteRepository,
    private readonly kitchensService: KitchensService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  /** Idempotent; a deleted or unknown kitchen is a 404 (a paused one is fine). */
  async add(userId: User['id'], kitchenId: Kitchen['id']): Promise<void> {
    const kitchen = await orNotFound(this.kitchensService.findById(kitchenId));
    await this.favoriteRepository.add(userId, kitchen.id);
  }

  async remove(userId: User['id'], kitchenId: Kitchen['id']): Promise<void> {
    const kitchen = await orNotFound(this.kitchensService.findById(kitchenId));
    await this.favoriteRepository.remove(userId, kitchen.id);
  }

  /** Discovery cards for the user's favorites, newest first; deleted kitchens drop out. */
  async list(
    userId: User['id'],
    query: ListFavoritesQueryDto,
  ): Promise<InfinityPaginationResponseDto<KitchenCard>> {
    const kitchens = await this.favoriteRepository.listKitchens(userId, {
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
    });
    const ctx = {
      userId,
      allergenPreferences: [],
      point: { latitude: query.lat, longitude: query.lng },
      pickupRadiusKm: this.configService.getOrThrow(
        'discovery.pickupRadiusKm',
        { infer: true },
      ),
      coordPrecision: this.configService.getOrThrow(
        'discovery.coordPrecision',
        { infer: true },
      ),
      now: new Date(),
      favoriteKitchenIds: new Set(kitchens.map((kitchen) => kitchen.id)),
    };

    return infinityPagination(
      kitchens.map((kitchen) =>
        kitchenCard(kitchen, roundedDistanceKm(kitchen, ctx), ctx),
      ),
      { page: query.page, limit: query.limit },
    );
  }

  /** Account deletion: hard delete. */
  removeAllForUser(userId: User['id']): Promise<void> {
    return this.favoriteRepository.removeAllForUser(userId);
  }

  async favoriteKitchenIds(
    userId: User['id'],
    kitchenIds: Kitchen['id'][],
  ): Promise<Set<Kitchen['id']>> {
    return new Set(
      await this.favoriteRepository.favoriteKitchenIds(userId, kitchenIds),
    );
  }
}
