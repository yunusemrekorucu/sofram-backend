import {
  ConflictException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AddressesService } from '../addresses/addresses.service';
import { Address } from '../addresses/domain/address';
import { assertNoFieldErrors } from '../catalog/field-errors';
import { foldTurkish } from '../catalog/fold-turkish';
import { FileType } from '../files/domain/file';
import { FilesService } from '../files/files.service';
import { User } from '../users/domain/user';
import { orNotFound } from '../utils/or-not-found';
import { Kitchen } from './domain/kitchen';
import { CreateKitchenDto } from './dto/create-kitchen.dto';
import { UpdateKitchenDto } from './dto/update-kitchen.dto';
import { KitchenRepository } from './infrastructure/persistence/kitchen.repository';
import { deliveryRadiusOf, kitchenRuleErrors } from './kitchen-rules';

/** What the cook controls; deliveryRadiusKm and searchText derive from it. */
type KitchenFields = Omit<
  Kitchen,
  'id' | 'createdAt' | 'updatedAt' | 'deliveryRadiusKm' | 'searchText'
>;

const addressFields = (address: Address) => ({
  fullAddress: address.fullAddress,
  district: address.district,
  neighborhood: address.neighborhood,
  latitude: address.latitude,
  longitude: address.longitude,
});

@Injectable()
export class KitchensService {
  constructor(
    private readonly kitchenRepository: KitchenRepository,
    private readonly addressesService: AddressesService,
    private readonly filesService: FilesService,
  ) {}

  findByOwner(ownerId: User['id']): Promise<Kitchen | null> {
    return this.kitchenRepository.findByOwnerId(ownerId);
  }

  findMine(ownerId: User['id']): Promise<Kitchen> {
    return orNotFound(this.kitchenRepository.findByOwnerId(ownerId));
  }

  async create(ownerId: User['id'], dto: CreateKitchenDto): Promise<Kitchen> {
    if (await this.kitchenRepository.findByOwnerId(ownerId)) {
      throw new ConflictException({
        status: HttpStatus.CONFLICT,
        error: 'kitchenAlreadyExists',
      });
    }

    const address = await this.addressesService.findOwned(
      ownerId,
      dto.addressId,
    );

    return this.kitchenRepository.create(
      this.withDerived({
        ownerId,
        name: dto.name,
        description: dto.description ?? null,
        coverPhoto: await this.coverPhoto(dto.coverPhotoId),
        ...addressFields(address),
        pickupEnabled: dto.pickupEnabled,
        deliveryEnabled: dto.deliveryEnabled,
        deliveryTiers: dto.deliveryTiers,
        freeDeliveryMinKurus: dto.freeDeliveryMinKurus ?? null,
        hours: dto.hours,
        isPaused: false,
        isVerified: false,
      }),
    );
  }

  async update(ownerId: User['id'], dto: UpdateKitchenDto): Promise<Kitchen> {
    const current = await this.findMine(ownerId);
    const { addressId, coverPhotoId, ...changes } = dto;
    const next: KitchenFields = { ...current, ...changes };

    if (addressId !== undefined) {
      Object.assign(
        next,
        addressFields(
          await this.addressesService.findOwned(ownerId, addressId),
        ),
      );
    }

    if (coverPhotoId !== undefined) {
      next.coverPhoto = await this.coverPhoto(coverPhotoId);
    }

    return this.kitchenRepository.update(current.id, this.withDerived(next));
  }

  /** Account deletion; products go first (ProductsService.removeAllForOwner). */
  removeForOwner(ownerId: User['id']): Promise<void> {
    return this.kitchenRepository.anonymizeAndSoftDeleteByOwnerId(ownerId);
  }

  private withDerived(
    fields: KitchenFields,
  ): KitchenFields & Pick<Kitchen, 'deliveryRadiusKm' | 'searchText'> {
    assertNoFieldErrors(kitchenRuleErrors(fields));

    return {
      ...fields,
      deliveryRadiusKm: deliveryRadiusOf(fields),
      searchText: foldTurkish(
        [fields.name, fields.description, fields.district, fields.neighborhood]
          .filter(Boolean)
          .join(' '),
      ),
    };
  }

  private async coverPhoto(
    id: string | null | undefined,
  ): Promise<FileType | null> {
    if (!id) {
      return null;
    }

    const [file] = await this.filesService.findByIds([id]);

    if (!file) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { coverPhotoId: 'imageNotExists' },
      });
    }

    return file;
  }
}
