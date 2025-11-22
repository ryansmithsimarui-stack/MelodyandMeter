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
  test('zero-duration both same start conflicts', () => {
    const now = Date.now() + 100000; // new timestamp to avoid interference
    persistence.createBooking('b2','user2','slotZ', now, 0, 'primary');
    const conflict = persistence.isSlotAvailableWithDuration('slotZ', now, 0, null, 'primary');
    expect(conflict).toBe(false);
  });
  test('zero-duration different start allowed', () => {
    const b2 = persistence.getBooking('b2');
    const later = b2.start_at + 60000; // +1 min
    const allowed = persistence.isSlotAvailableWithDuration('slotZ', later, 0, null, 'primary');
    expect(allowed).toBe(true);
  });
  test('zero-duration at start of existing non-zero booking allowed', () => {
    const b1 = persistence.getBooking('b1');
    const allowed = persistence.isSlotAvailableWithDuration('slot1', b1.start_at, 0, null, 'primary');
    // With existing 30min booking starting now, zero-duration booking at same start should not overlap per logic
    expect(allowed).toBe(true);
  });
  test('non-zero booking starting at end of zero-duration booking allowed', () => {
    const b2 = persistence.getBooking('b2');
    const allowed = persistence.isSlotAvailableWithDuration('slotZ', b2.start_at, 30, null, 'primary');
    expect(allowed).toBe(true);
  });
});
