import { SaleType } from '../../catalog/catalog.enums';
import { FileType } from '../../files/domain/file';

/** A line of an order: a copy of the product as it was when ordered. */
export class OrderItem {
  id: string;

  productId: string;

  /** Cart order, from 0. */
  position: number;

  name: string;

  unitPriceKurus: number;

  saleType: SaleType;

  prepMinutes: number | null;

  /** The product's first photo at order time. */
  photo: FileType | null;

  quantity: number;

  note: string | null;
}
