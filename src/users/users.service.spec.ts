import { AddressesService } from '../addresses/addresses.service';
import { FilesService } from '../files/files.service';
import { KitchensService } from '../kitchens/kitchens.service';
import { ProductsService } from '../products/products.service';
import { SessionService } from '../session/session.service';
import { User } from './domain/user';
import { UserRepository } from './infrastructure/persistence/user.repository';
import { UsersService } from './users.service';

const aUser = (overrides: Partial<User> = {}): User =>
  Object.assign(new User(), { id: 7, ...overrides });

const buildUsersService = () => {
  const repository = {
    findById: jest.fn(),
    findByEmail: jest.fn().mockResolvedValue(null),
    findByPhoneNumber: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((data) => aUser(data)),
    update: jest.fn().mockImplementation((id, data) => aUser({ id, ...data })),
    anonymizeAndSoftDelete: jest.fn(),
  };
  const addresses = { removeAllForUser: jest.fn() };
  const sessions = { deleteByUserId: jest.fn() };
  const products = { removeAllForOwner: jest.fn() };
  const kitchens = { removeForOwner: jest.fn() };

  const service = new UsersService(
    repository as unknown as UserRepository,
    {} as FilesService,
    addresses as unknown as AddressesService,
    sessions as unknown as SessionService,
    kitchens as unknown as KitchensService,
    products as unknown as ProductsService,
  );

  return { service, repository, addresses, sessions, kitchens, products };
};

describe('UsersService.remove', () => {
  it('should anonymize the user, then remove the menu, kitchen, addresses and sessions', async () => {
    const { service, repository, addresses, sessions, kitchens, products } =
      buildUsersService();

    await service.remove(7);

    expect(repository.anonymizeAndSoftDelete).toHaveBeenCalledWith(7);
    expect(products.removeAllForOwner).toHaveBeenCalledWith(7);
    expect(kitchens.removeForOwner).toHaveBeenCalledWith(7);
    expect(addresses.removeAllForUser).toHaveBeenCalledWith(7);
    expect(sessions.deleteByUserId).toHaveBeenCalledWith({ userId: 7 });

    const order = [
      repository.anonymizeAndSoftDelete,
      products.removeAllForOwner,
      kitchens.removeForOwner,
      addresses.removeAllForUser,
      sessions.deleteByUserId,
    ].map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('UsersService phone number uniqueness', () => {
  it('should refuse to create a user with a taken phone number', async () => {
    const { service, repository } = buildUsersService();
    repository.findByPhoneNumber.mockResolvedValue(aUser({ id: 3 }));

    await expect(
      service.create({
        phoneNumber: '+905551112233',
        email: null,
        firstName: null,
        lastName: null,
      }),
    ).rejects.toMatchObject({
      response: { errors: { phoneNumber: 'phoneAlreadyExists' } },
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("should refuse to move a user onto someone else's phone number", async () => {
    const { service, repository } = buildUsersService();
    repository.findByPhoneNumber.mockResolvedValue(aUser({ id: 3 }));

    await expect(
      service.update('7', { phoneNumber: '+905551112233' }),
    ).rejects.toMatchObject({
      response: { errors: { phoneNumber: 'phoneAlreadyExists' } },
    });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('should let a user keep their own phone number (route id is a string)', async () => {
    const { service, repository } = buildUsersService();
    repository.findByPhoneNumber.mockResolvedValue(aUser({ id: 7 }));

    await service.update('7', { phoneNumber: '+905551112233' });

    expect(repository.update).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({ phoneNumber: '+905551112233' }),
    );
  });
});
