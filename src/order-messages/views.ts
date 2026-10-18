import { ApiProperty } from '@nestjs/swagger';
import { MessageSide } from '../trust/trust.enums';

export class OrderMessageView {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ enum: MessageSide })
  senderRole: MessageSide;

  @ApiProperty({ type: String })
  body: string;

  @ApiProperty({ description: 'Sonraki sorgunun `after` değeri' })
  createdAt: Date;
}

/** GET …/messages — oldest first, at most 100. */
export class OrderMessagesView {
  @ApiProperty({ type: () => OrderMessageView, isArray: true })
  data: OrderMessageView[];

  @ApiProperty({
    type: Boolean,
    description: 'false: sohbet salt okunur ("Bu sohbet kapandı")',
  })
  canMessage: boolean;
}
