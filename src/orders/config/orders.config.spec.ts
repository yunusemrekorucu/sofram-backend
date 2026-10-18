import ordersConfig from './orders.config';

const KEYS = [
  'ORDER_ACCEPT_MINUTES',
  'ORDER_DELIVERY_BUFFER_MINUTES',
  'ORDER_SERVICE_FEE_PERCENT',
];

describe('ordersConfig', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    KEYS.forEach((key) => delete process.env[key]);
  });

  afterAll(() => {
    process.env = saved;
  });

  it('should default to 3 minutes, 15 minutes and 5 percent', () => {
    expect(ordersConfig()).toEqual({
      acceptMinutes: 3,
      deliveryBufferMinutes: 15,
      serviceFeePercent: 5,
    });
  });

  it('should read the environment', () => {
    process.env.ORDER_ACCEPT_MINUTES = '5';
    process.env.ORDER_DELIVERY_BUFFER_MINUTES = '20';
    process.env.ORDER_SERVICE_FEE_PERCENT = '7.5';

    expect(ordersConfig()).toEqual({
      acceptMinutes: 5,
      deliveryBufferMinutes: 20,
      serviceFeePercent: 7.5,
    });
  });

  it('should refuse out-of-range values', () => {
    process.env.ORDER_ACCEPT_MINUTES = '0';

    expect(() => ordersConfig()).toThrow();
  });
});
