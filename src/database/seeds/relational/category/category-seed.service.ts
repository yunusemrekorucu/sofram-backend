import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoryEntity } from '../../../../categories/infrastructure/persistence/relational/entities/category.entity';

const CATEGORIES = [
  {
    slug: 'main-dish',
    nameTr: 'Ana yemek',
    nameEn: 'Main dish',
    icon: 'main-dish',
  },
  { slug: 'soup', nameTr: 'Çorba', nameEn: 'Soup', icon: 'soup' },
  { slug: 'pastry', nameTr: 'Hamur işi', nameEn: 'Pastry', icon: 'pastry' },
  {
    slug: 'olive-oil',
    nameTr: 'Zeytinyağlı',
    nameEn: 'Olive oil dishes',
    icon: 'olive-oil',
  },
  { slug: 'dessert', nameTr: 'Tatlı', nameEn: 'Dessert', icon: 'dessert' },
  {
    slug: 'breakfast',
    nameTr: 'Kahvaltılık',
    nameEn: 'Breakfast',
    icon: 'breakfast',
  },
  { slug: 'salad', nameTr: 'Salata', nameEn: 'Salad', icon: 'salad' },
  { slug: 'drink', nameTr: 'İçecek', nameEn: 'Drink', icon: 'drink' },
];

@Injectable()
export class CategorySeedService {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly repository: Repository<CategoryEntity>,
  ) {}

  /** Inserts the missing slugs; never overwrites an admin's edits. */
  async run() {
    for (const [sortOrder, category] of CATEGORIES.entries()) {
      const exists = await this.repository.exists({
        where: { slug: category.slug },
      });

      if (!exists) {
        await this.repository.save(
          this.repository.create({ ...category, sortOrder, isActive: true }),
        );
      }
    }
  }
}
