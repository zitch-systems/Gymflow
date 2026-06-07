'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

export function MembersSearch({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(defaultValue);
  const [, startTransition] = useTransition();

  return (
    <form
      className="gf-search-wrap"
      onSubmit={(e) => {
        e.preventDefault();
        const next = new URLSearchParams(params?.toString() ?? '');
        if (value) next.set('q', value);
        else next.delete('q');
        startTransition(() => router.replace(`?${next.toString()}`));
      }}
    >
      <input
        type="search"
        className="gf-search-input"
        placeholder="Search by name, email, phone…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </form>
  );
}
