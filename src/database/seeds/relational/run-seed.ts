import { NestFactory } from '@nestjs/core';
import { CategorySeedService } from './category/category-seed.service';
import { KitchenSeedService } from './kitchen/kitchen-seed.service';
import { OrderSeedService } from './order/order-seed.service';
import { RoleSeedService } from './role/role-seed.service';
import { SeedModule } from './seed.module';
import { StatusSeedService } from './status/status-seed.service';
import { UserSeedService } from './user/user-seed.service';

const runSeed = async () => {
  const app = await NestFactory.create(SeedModule);

  // run
  await app.get(RoleSeedService).run();
  await app.get(StatusSeedService).run();
  await app.get(UserSeedService).run();
  await app.get(CategorySeedService).run();
  await app.get(KitchenSeedService).run();
  await app.get(OrderSeedService).run();

  await app.close();
};

void runSeed();
