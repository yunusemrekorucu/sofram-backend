import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Kitchen } from '../../../../../kitchens/domain/kitchen';
import { KitchenEntity } from '../../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { KitchenMapper } from '../../../../../kitchens/infrastructure/persistence/relational/mappers/kitchen.mapper';
import { User } from '../../../../../users/domain/user';
import { FavoritePage, FavoriteRepository } from '../../favorite.repository';
import { FavoriteEntity } from '../entities/favorite.entity';

@Injectable()
export class FavoriteRelationalRepository implements FavoriteRepository {
  constructor(
    @InjectRepository(FavoriteEntity)
    private readonly favorites: Repository<FavoriteEntity>,
  ) {}

  async add(userId: User['id'], kitchenId: Kitchen['id']): Promise<void> {
    await this.favorites
      .createQueryBuilder()
      .insert()
      .into(FavoriteEntity)
      .values({ userId: Number(userId), kitchenId })
      .orIgnore()
      .execute();
  }

  async remove(userId: User['id'], kitchenId: Kitchen['id']): Promise<void> {
    await this.favorites.delete({ userId: Number(userId), kitchenId });
  }

  async listKitchens(
    userId: User['id'],
    page: FavoritePage,
  ): Promise<Kitchen[]> {
    const rows = await this.favorites
      .createQueryBuilder('f')
      .innerJoinAndSelect('f.kitchen', 'k')
      .where('f."userId" = :userId', { userId: Number(userId) })
      .andWhere('k."deletedAt" IS NULL')
      .orderBy('f.createdAt', 'DESC')
      .addOrderBy('f.id', 'DESC')
      .offset(page.offset)
      .limit(page.limit)
      .getMany();

    return rows.map((row) =>
      KitchenMapper.toDomain(row.kitchen as KitchenEntity),
    );
  }

  async favoriteKitchenIds(
    userId: User['id'],
    kitchenIds: Kitchen['id'][],
  ): Promise<Kitchen['id'][]> {
    if (kitchenIds.length === 0) {
      return [];
    }

    const rows = await this.favorites.find({
      select: { kitchenId: true },
      where: { userId: Number(userId), kitchenId: In(kitchenIds) },
    });
    return rows.map((row) => row.kitchenId);
  }
}
