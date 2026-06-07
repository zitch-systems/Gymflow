import { test as base, expect, type Page } from '@playwright/test';

export { expect };

export type TestMember = {
  email: string;
  password: string;
  fullName: string;
  phone: string;
};

export function uniqueMember(): TestMember {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return {
    email: `playwright-e2e-${stamp}@example.com`,
    password: 'TestPassword123!',
    fullName: `Test Member ${stamp}`,
    phone: '08000000000',
  };
}

export async function signUpMember(page: Page, member: TestMember) {
  await page.goto('/join');
  await page.locator('input[name="full_name"]').fill(member.fullName);
  await page.locator('input[name="email"]').fill(member.email);
  await page.locator('input[name="phone"]').fill(member.phone);
  await page.locator('input[name="password"]').fill(member.password);
  await page.locator('input[name="nok_name"]').fill('NOK Person');
  await page.locator('select[name="nok_relationship"]').selectOption('friend');
  await page.locator('input[name="nok_phone"]').fill('08011111111');
  await page.locator('input[name="waiver_signed"]').check();
  await page.getByRole('button', { name: /create membership/i }).click();
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  // Label is "Email" (singular) on the OPay-style auth form.
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

export const test = base.extend({});
