// Shared server-side password validator. Must match the 4-rule UI checklist
// shown on the reset-password and signup pages.
export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) return 'Password must include an uppercase and lowercase letter.';
  if (!/\d/.test(password)) return 'Password must include a number.';
  if (/^[A-Za-z0-9]*$/.test(password)) return 'Password must include a symbol.';
  return null;
}
