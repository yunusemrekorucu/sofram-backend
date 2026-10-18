import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthProvidersEnum } from '../../../../auth/auth-providers.enum';
import { Allergen, DietTag, SaleType } from '../../../../catalog/catalog.enums';
import { foldTurkish } from '../../../../catalog/fold-turkish';
import { CategoryEntity } from '../../../../categories/infrastructure/persistence/relational/entities/category.entity';
import { KitchenEntity } from '../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { deliveryRadiusOf } from '../../../../kitchens/kitchen-rules';
import { ProductEntity } from '../../../../products/infrastructure/persistence/relational/entities/product.entity';
import { RoleEnum } from '../../../../roles/roles.enum';
import { StatusEnum } from '../../../../statuses/statuses.enum';
import { UserEntity } from '../../../../users/infrastructure/persistence/relational/entities/user.entity';

type SeedProduct = {
  category: string;
  name: string;
  description: string;
  priceKurus: number;
  saleType: SaleType;
  prepMinutes?: number;
  portionsAvailable?: number;
  allergens: Allergen[];
  dietTags: DietTag[];
};

type SeedKitchen = {
  phoneNumber: string;
  firstName: string;
  lastName: string;
  name: string;
  description: string;
  district: string;
  neighborhood: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  freeDeliveryMinKurus: number | null;
  minOrderKurus: number | null;
  products: SeedProduct[];
};

const WEEKDAYS_11_TO_20 = [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  opensAt: '11:00',
  closesAt: '20:00',
}));

const TIERS = [
  { upToKm: 1, feeKurus: 0 },
  { upToKm: 3, feeKurus: 2000 },
  { upToKm: 5, feeKurus: 3500 },
];

const KITCHENS: SeedKitchen[] = [
  {
    phoneNumber: '+905550000101',
    firstName: 'Ayşe',
    lastName: 'Yılmaz',
    name: 'Ayşe Teyze’nin Mutfağı',
    description: 'Moda’da annemin tarifleriyle ev yemekleri.',
    district: 'Kadıköy',
    neighborhood: 'Caferağa',
    fullAddress: 'Caferağa Mh. Moda Cd. No:10',
    latitude: 40.9862,
    longitude: 29.0254,
    pickupEnabled: true,
    deliveryEnabled: true,
    freeDeliveryMinKurus: 30000,
    minOrderKurus: null,
    products: [
      {
        category: 'pastry',
        name: 'Ev usulü mantı',
        description: 'Yoğurt ve tereyağlı sos ile.',
        priceKurus: 14000,
        saleType: SaleType.onDemand,
        prepMinutes: 45,
        allergens: [Allergen.gluten, Allergen.milk, Allergen.eggs],
        dietTags: [],
      },
      {
        category: 'soup',
        name: 'Mercimek çorbası',
        description: 'Limon ve kıtır ekmekle.',
        priceKurus: 6000,
        saleType: SaleType.dailyPortion,
        portionsAvailable: 12,
        allergens: [Allergen.celery],
        dietTags: [DietTag.vegan],
      },
      {
        category: 'main-dish',
        name: 'Karnıyarık',
        description: 'Pilav ile servis edilir.',
        priceKurus: 16000,
        saleType: SaleType.dailyPortion,
        portionsAvailable: 6,
        allergens: [],
        dietTags: [],
      },
      {
        category: 'dessert',
        name: 'Fırın sütlaç',
        description: 'Bol tarçınlı.',
        priceKurus: 6500,
        saleType: SaleType.dailyPortion,
        portionsAvailable: 8,
        allergens: [Allergen.milk],
        dietTags: [DietTag.vegetarian],
      },
    ],
  },
  {
    phoneNumber: '+905550000102',
    firstName: 'Nuran',
    lastName: 'Kaya',
    name: 'Nuran Hanım Zeytinyağlıları',
    description: 'Ege usulü zeytinyağlılar.',
    district: 'Kadıköy',
    neighborhood: 'Fenerbahçe',
    fullAddress: 'Fenerbahçe Mh. Fener Kalamış Cd. No:22',
    latitude: 40.9741,
    longitude: 29.0387,
    pickupEnabled: true,
    deliveryEnabled: false,
    freeDeliveryMinKurus: null,
    minOrderKurus: null,
    products: [
      {
        category: 'olive-oil',
        name: 'Zeytinyağlı enginar',
        description: 'Bezelye ve havuçlu.',
        priceKurus: 12000,
        saleType: SaleType.dailyPortion,
        portionsAvailable: 5,
        allergens: [],
        dietTags: [DietTag.vegan],
      },
      {
        category: 'olive-oil',
        name: 'Yaprak sarma',
        description: 'Limonlu, zeytinyağlı.',
        priceKurus: 11000,
        saleType: SaleType.dailyPortion,
        portionsAvailable: 10,
        allergens: [],
        dietTags: [DietTag.vegan],
      },
      {
        category: 'salad',
        name: 'Gavurdağı salatası',
        description: 'Cevizli, nar ekşili.',
        priceKurus: 8000,
        saleType: SaleType.onDemand,
        prepMinutes: 15,
        allergens: [Allergen.treeNuts],
        dietTags: [DietTag.vegan],
      },
      {
        category: 'breakfast',
        name: 'Menemen',
        description: 'Köy yumurtası ile.',
        priceKurus: 9000,
        saleType: SaleType.onDemand,
        prepMinutes: 20,
        allergens: [Allergen.eggs],
        dietTags: [DietTag.vegetarian],
      },
    ],
  },
  {
    phoneNumber: '+905550000103',
    firstName: 'Hatice',
    lastName: 'Demir',
    name: 'Hatice Teyze Börek Evi',
    description: 'Her sabah taze börek.',
    district: 'Kadıköy',
    neighborhood: 'Koşuyolu',
    fullAddress: 'Koşuyolu Mh. Mahmut Yesari Cd. No:5',
    latitude: 41.0012,
    longitude: 29.0389,
    pickupEnabled: false,
    deliveryEnabled: true,
    freeDeliveryMinKurus: null,
    minOrderKurus: 15000,
    products: [
      {
        category: 'pastry',
        name: 'Su böreği',
        description: 'Peynirli, tepsi dilimi.',
        priceKurus: 9500,
        saleType: SaleType.dailyPortion,
        portionsAvailable: 15,
        allergens: [Allergen.gluten, Allergen.milk, Allergen.eggs],
        dietTags: [DietTag.vegetarian],
      },
      {
        category: 'pastry',
        name: 'Ispanaklı gözleme',
        description: 'Sac üstünde.',
        priceKurus: 8000,
        saleType: SaleType.onDemand,
        prepMinutes: 25,
        allergens: [Allergen.gluten],
        dietTags: [DietTag.vegan],
      },
      {
        category: 'main-dish',
        name: 'İçli köfte',
        description: 'Haşlama, 3 adet.',
        priceKurus: 13000,
        saleType: SaleType.dailyPortion,
        portionsAvailable: 0,
        allergens: [Allergen.gluten, Allergen.treeNuts],
        dietTags: [],
      },
      {
        category: 'drink',
        name: 'Ev yapımı ayran',
        description: 'Köpüklü.',
        priceKurus: 2500,
        saleType: SaleType.onDemand,
        prepMinutes: 5,
        allergens: [Allergen.milk],
        dietTags: [DietTag.vegetarian],
      },
    ],
  },
];

/** Development data only: three cooks near Moda with a menu each (no photos). */
@Injectable()
export class KitchenSeedService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(KitchenEntity)
    private readonly kitchens: Repository<KitchenEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
  ) {}

  async run() {
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    const categoryIds = new Map(
      (await this.categories.find()).map((c) => [c.slug, c.id]),
    );

    for (const seed of KITCHENS) {
      if (
        await this.users.exists({ where: { phoneNumber: seed.phoneNumber } })
      ) {
        continue;
      }

      const owner = await this.users.save(
        this.users.create({
          phoneNumber: seed.phoneNumber,
          firstName: seed.firstName,
          lastName: seed.lastName,
          email: null,
          provider: AuthProvidersEnum.phone,
          kvkkAcceptedAt: new Date(),
          role: { id: RoleEnum.user },
          status: { id: StatusEnum.active },
        }),
      );

      const kitchen = await this.kitchens.save(
        this.kitchens.create({
          ownerId: owner.id,
          name: seed.name,
          description: seed.description,
          coverPhoto: null,
          fullAddress: seed.fullAddress,
          district: seed.district,
          neighborhood: seed.neighborhood,
          latitude: seed.latitude,
          longitude: seed.longitude,
          pickupEnabled: seed.pickupEnabled,
          deliveryEnabled: seed.deliveryEnabled,
          deliveryTiers: TIERS,
          deliveryRadiusKm: deliveryRadiusOf({
            deliveryEnabled: seed.deliveryEnabled,
            deliveryTiers: TIERS,
          }),
          freeDeliveryMinKurus: seed.freeDeliveryMinKurus,
          minOrderKurus: seed.minOrderKurus,
          hours: WEEKDAYS_11_TO_20,
          isPaused: false,
          isVerified: false,
          searchText: foldTurkish(
            `${seed.name} ${seed.description} ${seed.district} ${seed.neighborhood}`,
          ),
        }),
      );

      await this.products.save(
        seed.products.map((product) =>
          this.products.create({
            kitchenId: kitchen.id,
            categoryId: categoryIds.get(product.category),
            name: product.name,
            description: product.description,
            priceKurus: product.priceKurus,
            saleType: product.saleType,
            prepMinutes: product.prepMinutes ?? null,
            portionsAvailable: product.portionsAvailable ?? null,
            allergens: product.allergens,
            dietTags: product.dietTags,
            photos: [],
            isActive: true,
            searchText: foldTurkish(`${product.name} ${product.description}`),
          }),
        ),
      );
    }
  }
}
