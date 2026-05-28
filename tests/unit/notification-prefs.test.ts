import { describe, it, expect } from 'vitest';
import { respectsEmail, respectsWhatsapp } from '@/lib/notification-prefs';

describe('notification-prefs', () => {
  it('defaults to opted-in when the profile is missing (pre-migration row)', () => {
    expect(respectsEmail(null)).toBe(true);
    expect(respectsEmail(undefined)).toBe(true);
    expect(respectsWhatsapp(null)).toBe(true);
    expect(respectsWhatsapp(undefined)).toBe(true);
  });

  it('defaults to opted-in when the column value is null/undefined', () => {
    expect(respectsEmail({ notification_email: null, notification_whatsapp: null })).toBe(true);
    expect(respectsWhatsapp({ notification_email: null, notification_whatsapp: null })).toBe(true);
    expect(respectsEmail({})).toBe(true);
  });

  it('honours an explicit false (the only way to opt out)', () => {
    expect(respectsEmail({ notification_email: false })).toBe(false);
    expect(respectsWhatsapp({ notification_whatsapp: false })).toBe(false);
  });

  it('explicit true is opted-in', () => {
    expect(respectsEmail({ notification_email: true })).toBe(true);
    expect(respectsWhatsapp({ notification_whatsapp: true })).toBe(true);
  });
});
