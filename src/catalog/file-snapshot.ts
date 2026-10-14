import { FileType } from '../files/domain/file';

/** A file stored inline (jsonb) on the record that shows it. */
export type FileSnapshot = { id: string; path: string };

export const toSnapshot = (file: FileType): FileSnapshot => ({
  id: file.id,
  path: file.path,
});

/** Back to a FileType instance so its @Transform turns `path` into a URL. */
export const toFileType = (snapshot: FileSnapshot): FileType =>
  Object.assign(new FileType(), snapshot);
