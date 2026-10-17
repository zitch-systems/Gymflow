import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(relativePath) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, URL }, { filename: relativePath });
  return module.exports;
}

const { gymPortalUrl, isGymCheckinCode } = load('../src/lib/gym-links.ts');
const base = 'https://www.gymflow.ng';
assert.equal(gymPortalUrl(base, 'iron', '/dashboard/documents'), 'https://iron.gymflow.ng/dashboard/documents');
assert.equal(gymPortalUrl('http://localhost:3000', 'iron', '/forgot-password'), 'http://localhost:3000/forgot-password');
assert.equal(isGymCheckinCode('https://iron.gymflow.ng/checkin?via=qr', base, 'iron'), true);
assert.equal(isGymCheckinCode('https://iron.gymflow.ng/checkin/?via=qr', base, 'iron'), true);
for (const code of [
  'https://other.gymflow.ng/checkin?via=qr',
  'https://evil.example/checkin?via=qr',
  'https://iron.gymflow.ng.evil.example/checkin?via=qr',
  'https://evil.example/?via=qr',
  'https://iron.gymflow.ng/dashboard?via=qr',
  'https://iron.gymflow.ng/checkin',
  'https://iron.gymflow.ng/checkin?via=self',
  'https://user:password@iron.gymflow.ng/checkin?via=qr',
  'http://iron.gymflow.ng/checkin?via=qr',
  'WIFI:S:Gym;T:WPA;P:secret;;',
]) assert.equal(isGymCheckinCode(code, base, 'iron'), false, code);
assert.equal(isGymCheckinCode('https://iron.gymflow.ng/checkin?via=qr', base, null), false);

const { bookingForSlot, canCancelBooking } = load('../src/lib/class-bookings.ts');
const slot = { id: 'yoga-monday', next_date: '2026-10-19' };
const existing = { id: 'booking', class_schedule_id: slot.id, booking_date: '2026-10-26', status: 'booked' };
assert.equal(bookingForSlot(slot, [existing]), undefined, 'a future-week booking must not block next week');
const current = { ...existing, booking_date: slot.next_date };
assert.equal(bookingForSlot(slot, [current]), current);
assert.equal(bookingForSlot(slot, [{ ...current, status: 'waitlisted' }]).status, 'waitlisted');
assert.equal(bookingForSlot(slot, [{ ...current, status: 'cancelled' }]), undefined);
assert.equal(bookingForSlot(slot, [{ ...current, status: 'attended' }]), undefined);
assert.equal(canCancelBooking(current, '2026-10-17'), true);
assert.equal(canCancelBooking({ ...current, status: 'waitlisted' }, '2026-10-19'), true);
assert.equal(canCancelBooking({ ...current, status: 'attended' }, '2026-10-19'), false);
assert.equal(canCancelBooking(current, '2026-10-20'), false);
assert.equal(canCancelBooking({ ...current, booking_date: null }, '2026-10-17'), false);
console.log('Member-flow checks passed: tenant QR codes, portal links, dated class bookings and cancellation eligibility.');
