// Facility domain constants, shared by the facility server actions and the
// client form that renders them.
//
// These live here — NOT in lib/actions/facility.ts — because that file is a
// 'use server' module, and Next.js allows a 'use server' file to export ONLY
// async functions. A plain `export const` there throws at RUNTIME the moment
// any action in the module is invoked ("A 'use server' file can only export
// async functions, found object"), which took /admin/operations down entirely
// and, because server actions share a bundle chunk, surfaced on sign-out too.

// Matches the expense_category enum labels in the DB.
export const EXPENSE_CATEGORIES = [
  'utilities', 'maintenance', 'supplies', 'salaries', 'rent', 'marketing', 'equipment', 'other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
