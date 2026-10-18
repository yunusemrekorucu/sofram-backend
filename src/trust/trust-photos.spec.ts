import { UnprocessableEntityException } from '@nestjs/common';
import { FileType } from '../files/domain/file';
import { FilesService } from '../files/files.service';
import { photosByIds } from './trust-photos';

const file = (id: string) =>
  Object.assign(new FileType(), { id, path: `/${id}.png` });

const filesService = (known: string[]) =>
  ({
    findByIds: jest.fn((ids: string[]) =>
      Promise.resolve(ids.filter((id) => known.includes(id)).map(file)),
    ),
  }) as unknown as FilesService;

describe('photosByIds', () => {
  it('should keep the requested order', async () => {
    const photos = await photosByIds(filesService(['a', 'b']), ['b', 'a']);

    expect(photos.map((photo) => photo.id)).toEqual(['b', 'a']);
  });

  it('should 422 an unknown file', async () => {
    const error = await photosByIds(filesService(['a']), ['a', 'x']).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toEqual({
      status: 422,
      errors: { photoIds: 'imageNotExists' },
    });
  });

  it('should not query without photos', async () => {
    const files = filesService([]);

    await expect(photosByIds(files, [])).resolves.toEqual([]);
    expect(files.findByIds).not.toHaveBeenCalled();
  });
});
