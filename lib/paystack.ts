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
}): Promise<PaystackInitializeResult['data']> {
  const data = await paystackFetch<PaystackInitializeResult>(
    '/transaction/initialize',
    {
      method: 'POST',
      body: JSON.stringify({
        email: args.email,
        amount: Math.round(args.amount * 100),
        currency: 'NGN',
        callback_url: args.callbackUrl,
        metadata: args.metadata ?? {},
      }),
    },
  );
  return data.data;
}

export async function verifyTransaction(reference: string): Promise<PaystackVerifyResult['data']> {
  const data = await paystackFetch<PaystackVerifyResult>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
  return data.data;
}
