process.env.NODE_ENV = 'test';
const persistence = require('../persistence');

describe('Booking overlap logic', () => {
  beforeAll(() => { persistence.reset(); });
  test('detects overlap within same slot & resource', () => {
    const now = Date.now();
    // Booking A: slot1 30min
    persistence.createBooking('b1','user1','slot1', now, 30, 'primary');
    // Attempt overlapping booking starting 15 min in (should overlap)
    const startOverlap = now + 15*60000;
    const available = persistence.isSlotAvailableWithDuration('slot1', startOverlap, 30, null, 'primary');
    expect(available).toBe(false);
  });
  test('allows adjacency (end == start)', () => {
    const b1 = persistence.getBooking('b1');
    const endB1 = b1.start_at + b1.duration_min*60000;
    const adjacentAvailable = persistence.isSlotAvailableWithDuration('slot1', endB1, 30, null, 'primary');
    expect(adjacentAvailable).toBe(true);
  });
  test('allows same time different resource', () => {
    const b1 = persistence.getBooking('b1');
    const sameTimeDifferentResource = persistence.isSlotAvailableWithDuration('slot1', b1.start_at, 30, null, 'secondary');
    expect(sameTimeDifferentResource).toBe(true);
  });
});
