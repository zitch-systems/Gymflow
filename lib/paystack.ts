import 'server-only';

const PAYSTACK_BASE = 'https://api.paystack.co';

export function paystackSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not set');
  return key;
}

export async function paystackFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(PAYSTACK_BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${paystackSecretKey()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  const data = (await res.json()) as T & { status?: boolean; message?: string };
  if (!res.ok || data?.status === false) {
    throw new Error(data?.message ?? `Paystack ${res.status}`);
  }
  return data;
}

export type PaystackInitializeResult = {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
};

export type PaystackVerifyResult = {
  status: boolean;
  message: string;
  data: {
    status: string;
    reference: string;
    amount: number;
    currency: string;
    customer: { email: string };
    authorization?: {
      authorization_code?: string;
      bin?: string;
      last4?: string;
      exp_month?: string;
      exp_year?: string;
      card_type?: string;
      bank?: string;
      brand?: string;
      reusable?: boolean;
    };
    metadata?: Record<string, unknown>;
  };
};

export async function initializeTransaction(args: {
  email: string;
  amount: number; // Naira whole units; we convert to kobo
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
  subaccount?: string; // Paystack subaccount code — routes funds to gym
  bearer?: 'account' | 'subaccount'; // who pays Paystack's fees
}): Promise<PaystackInitializeResult['data']> {
  const body: Record<string, unknown> = {
    email: args.email,
    amount: Math.round(args.amount * 100),
    currency: 'NGN',
    callback_url: args.callbackUrl,
    metadata: args.metadata ?? {},
  };
  if (args.subaccount) {
    body.subaccount = args.subaccount;
    if (args.bearer) body.bearer = args.bearer;
  }
  const data = await paystackFetch<PaystackInitializeResult>(
    '/transaction/initialize',
    { method: 'POST', body: JSON.stringify(body) },
  );
  return data.data;
}

export async function verifyTransaction(reference: string): Promise<PaystackVerifyResult['data']> {
  const data = await paystackFetch<PaystackVerifyResult>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
  return data.data;
}

export type PaystackBank = { name: string; code: string; slug: string; longcode: string };

export async function listBanks(): Promise<PaystackBank[]> {
  const data = await paystackFetch<{ status: boolean; data: PaystackBank[] }>(
    '/bank?country=nigeria&currency=NGN',
  );
  return data.data;
}

export async function resolveAccount(accountNumber: string, bankCode: string): Promise<{ account_number: string; account_name: string }> {
  const data = await paystackFetch<{ status: boolean; data: { account_number: string; account_name: string } }>(
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
  );
  return data.data;
}

export type PaystackSubaccount = { subaccount_code: string; business_name: string };

export async function createSubaccount(args: {
  businessName: string;
  bankCode: string;
  accountNumber: string;
  percentageCharge: number; // platform commission % — Paystack keeps this share
  primaryContactEmail?: string;
  primaryContactName?: string;
  primaryContactPhone?: string;
}): Promise<PaystackSubaccount> {
  const data = await paystackFetch<{ status: boolean; data: PaystackSubaccount }>(
    '/subaccount',
    {
      method: 'POST',
      body: JSON.stringify({
        business_name: args.businessName,
        settlement_bank: args.bankCode,
        account_number: args.accountNumber,
        percentage_charge: args.percentageCharge,
        primary_contact_email: args.primaryContactEmail,
        primary_contact_name: args.primaryContactName,
        primary_contact_phone: args.primaryContactPhone,
      }),
    },
  );
  return data.data;
}

export async function updateSubaccount(code: string, args: {
  businessName?: string;
  bankCode?: string;
  accountNumber?: string;
  percentageCharge?: number;
}): Promise<PaystackSubaccount> {
  const data = await paystackFetch<{ status: boolean; data: PaystackSubaccount }>(
    `/subaccount/${encodeURIComponent(code)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        business_name: args.businessName,
        settlement_bank: args.bankCode,
        account_number: args.accountNumber,
        percentage_charge: args.percentageCharge,
      }),
    },
  );
  return data.data;
}
