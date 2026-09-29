import { Module } from '@nestjs/common';
import { AddressRepository } from '../address.repository';
import { AddressRelationalRepository } from './repositories/address.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressEntity } from './entities/address.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AddressEntity])],
  providers: [
    {
      provide: AddressRepository,
      useClass: AddressRelationalRepository,
    },
  ],
  exports: [AddressRepository],
})
export class RelationalAddressPersistenceModule {}
