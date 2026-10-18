import { HttpStatus, UnprocessableEntityException } from '@nestjs/common';
import { FileType } from '../files/domain/file';
import { FilesService } from '../files/files.service';

/** Uploaded files in the requested order; any unknown id is a 422 `photoIds: imageNotExists`. */
export async function photosByIds(
  filesService: FilesService,
  ids: string[],
): Promise<FileType[]> {
  if (ids.length === 0) {
    return [];
  }

  const byId = new Map(
    (await filesService.findByIds(ids)).map((file) => [file.id, file]),
  );

  if (ids.some((id) => !byId.has(id))) {
    throw new UnprocessableEntityException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      errors: { photoIds: 'imageNotExists' },
    });
  }

  return ids.map((id) => byId.get(id) as FileType);
}
