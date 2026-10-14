import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { Allergen, DietTag } from '../catalog/catalog.enums';
import { MAX_DELIVERY_RADIUS_KM } from '../catalog/delivery';
import { LatLng, boundingBox, haversineSql } from '../catalog/geo';
import { Kitchen } from '../kitchens/domain/kitchen';
import { KitchenEntity } from '../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { KitchenMapper } from '../kitchens/infrastructure/persistence/relational/mappers/kitchen.mapper';
import { Product } from '../products/domain/product';
import { ProductEntity } from '../products/infrastructure/persistence/relational/entities/product.entity';
import { ProductMapper } from '../products/infrastructure/persistence/relational/mappers/product.mapper';

export type DiscoveryFilter = {
  point: LatLng;
  pickupRadiusKm: number;
  /** Istanbul weekday and "HH:mm" — orders open kitchens first. */
  clock: { dayOfWeek: number; time: string };
  categoryId?: string;
  diet?: DietTag;
  excludeAllergens: Allergen[];
  /** A likePattern(): folded and escaped. */
  query?: string;
  offset: number;
  limit: number;
};

export type KitchenHit = { kitchen: Kitchen; distanceKm: number };
export type ProductHit = {
  product: Product;
  kitchen: Kitchen;
  distanceKm: number;
};

const DISTANCE = haversineSql('k');

/** openingState().isOpenNow in SQL; "HH:mm" strings sort in time order. */
const OPEN_NOW =
  `(NOT k."isPaused" AND EXISTS (SELECT 1 FROM jsonb_array_elements(k."hours") AS slot ` +
  `WHERE (slot->>'dayOfWeek')::int = :dayOfWeek ` +
  `AND slot->>'opensAt' <= :time AND slot->>'closesAt' > :time))`;

/** isProductListed() in SQL, for product alias `p` and its category `c`. */
const listed = (p: string, c: string) =>
  `${p}."deletedAt" IS NULL AND ${p}."isActive" AND ${c}."isActive" ` +
  `AND (${p}."saleType" = 'on_demand' OR ${p}."portionsAvailable" > 0)`;

/**
 * Read side of discovery. Plain SQL over the kitchen/product tables (no
 * PostGIS): a bounding box narrows by index, haversine decides. Rules here
 * mirror visibility.ts.
 */
@Injectable()
export class DiscoveryRepository {
  constructor(
    @InjectRepository(KitchenEntity)
    private readonly kitchens: Repository<KitchenEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
  ) {}

  async findKitchens(filter: DiscoveryFilter): Promise<KitchenHit[]> {
    const qb = this.kitchens
      .createQueryBuilder('k')
      .addSelect(DISTANCE, 'distance_km')
      .addSelect(OPEN_NOW, 'open_now');
    this.whereReachable(qb, filter);

    const productFilters = this.productFilters('p', filter);

    if (productFilters.length > 0 || filter.query) {
      const matches = filter.query
        ? [
            ...productFilters,
            '(p."searchText" LIKE :query OR k."searchText" LIKE :query)',
          ]
        : productFilters;
      const hasMatchingProduct =
        `EXISTS (SELECT 1 FROM "product" p INNER JOIN "category" c ON c."id" = p."categoryId" ` +
        `WHERE p."kitchenId" = k."id" AND ${listed('p', 'c')} AND ${matches.join(' AND ')})`;

      // A name match alone lists the kitchen only while no product filter is set.
      qb.andWhere(
        productFilters.length > 0
          ? hasMatchingProduct
          : `(k."searchText" LIKE :query OR ${hasMatchingProduct})`,
      );
    }

    const { entities, raw } = await this.page(
      qb,
      filter,
      'k',
    ).getRawAndEntities();
    const distanceById = this.distances(
      raw as { k_id: string; distance_km: number }[],
      'k_id',
    );

    return entities.map((entity) => ({
      kitchen: KitchenMapper.toDomain(entity),
      distanceKm: distanceById.get(entity.id) ?? 0,
    }));
  }

  async findProducts(filter: DiscoveryFilter): Promise<ProductHit[]> {
    const qb = this.products
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.category', 'c')
      .innerJoinAndSelect('p.kitchen', 'k')
      .addSelect(DISTANCE, 'distance_km')
      .addSelect(OPEN_NOW, 'open_now')
      .where(listed('p', 'c'));
    this.whereReachable(qb, filter);

    for (const condition of this.productFilters('p', filter)) {
      qb.andWhere(condition);
    }

    if (filter.query) {
      qb.andWhere('p."searchText" LIKE :query');
    }

    const { entities, raw } = await this.page(
      qb,
      filter,
      'p',
    ).getRawAndEntities();
    const distanceById = this.distances(
      raw as { p_id: string; distance_km: number }[],
      'p_id',
    );

    return entities.map((entity) => ({
      product: ProductMapper.toDomain(entity),
      kitchen: KitchenMapper.toDomain(entity.kitchen as KitchenEntity),
      distanceKm: distanceById.get(entity.id) ?? 0,
    }));
  }

  async findKitchenById(id: Kitchen['id']): Promise<Kitchen | null> {
    const entity = await this.kitchens.findOne({ where: { id } });
    return entity ? KitchenMapper.toDomain(entity) : null;
  }

  /** null when missing, deleted, or its kitchen is deleted. */
  async findProductById(
    id: Product['id'],
  ): Promise<{ product: Product; kitchen: Kitchen } | null> {
    const entity = await this.products.findOne({
      where: { id },
      relations: { kitchen: true },
    });

    if (!entity?.kitchen) {
      return null;
    }

    return {
      product: ProductMapper.toDomain(entity),
      kitchen: KitchenMapper.toDomain(entity.kitchen),
    };
  }

  /** Listed products of one kitchen, by category order, then oldest first. */
  async findListedProductsOfKitchen(
    kitchenId: Kitchen['id'],
  ): Promise<Product[]> {
    const entities = await this.products
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.category', 'c')
      .where('p."kitchenId" = :kitchenId', { kitchenId })
      .andWhere(listed('p', 'c'))
      .orderBy('c.sortOrder', 'ASC')
      .addOrderBy('p.createdAt', 'ASC')
      .getMany();

    return entities.map((entity) => ProductMapper.toDomain(entity));
  }

  /** Mirrors isKitchenReachable(); expects kitchen alias `k`. */
  private whereReachable<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    filter: DiscoveryFilter,
  ): void {
    const box = boundingBox(
      filter.point,
      Math.max(MAX_DELIVERY_RADIUS_KM, filter.pickupRadiusKm),
    );

    qb.andWhere('k."deletedAt" IS NULL')
      .andWhere(
        'k."latitude" BETWEEN :minLat AND :maxLat AND k."longitude" BETWEEN :minLng AND :maxLng',
        box,
      )
      .andWhere(
        `((k."deliveryEnabled" AND ${DISTANCE} <= k."deliveryRadiusKm") ` +
          `OR (k."pickupEnabled" AND ${DISTANCE} <= :pickupRadiusKm))`,
      );
  }

  private productFilters(p: string, filter: DiscoveryFilter): string[] {
    const conditions: string[] = [];

    if (filter.categoryId) {
      conditions.push(`${p}."categoryId" = :categoryId`);
    }

    if (filter.diet === DietTag.vegan) {
      conditions.push(`'vegan' = ANY(string_to_array(${p}."dietTags", ','))`);
    }

    if (filter.diet === DietTag.vegetarian) {
      conditions.push(
        `string_to_array(${p}."dietTags", ',') && ARRAY['vegetarian', 'vegan']`,
      );
    }

    if (filter.excludeAllergens.length > 0) {
      conditions.push(
        `NOT (string_to_array(${p}."allergens", ',') && CAST(:excludeAllergens AS text[]))`,
      );
    }

    return conditions;
  }

  /** Shared parameters, ordering (open first, nearest first) and paging. */
  private page<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    filter: DiscoveryFilter,
    alias: string,
  ): SelectQueryBuilder<T> {
    const parameters: Record<string, unknown> = {
      lat: filter.point.latitude,
      lng: filter.point.longitude,
      pickupRadiusKm: filter.pickupRadiusKm,
      dayOfWeek: filter.clock.dayOfWeek,
      time: filter.clock.time,
      categoryId: filter.categoryId,
      excludeAllergens: filter.excludeAllergens,
      query: filter.query,
    };

    return qb
      .setParameters(
        Object.fromEntries(
          Object.entries(parameters).filter(([, value]) => value !== undefined),
        ),
      )
      .orderBy('open_now', 'DESC')
      .addOrderBy('distance_km', 'ASC')
      .addOrderBy(`${alias}.id`, 'ASC')
      .offset(filter.offset)
      .limit(filter.limit);
  }

  private distances<K extends string>(
    rows: (Record<K, string> & { distance_km: number })[],
    idColumn: K,
  ): Map<string, number> {
    return new Map(rows.map((row) => [row[idColumn], Number(row.distance_km)]));
  }
}
