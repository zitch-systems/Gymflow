import '@/app/admin.css';

import { requireStaff } from '@/lib/auth/gym';
import { getProfile } from '@/lib/auth/dal';
import { AdminShell } from './admin-shell';

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

export default async function AdminLayout({ children, params }: LayoutProps) {
  const { slug } = await params;
  const { role, gym } = await requireStaff(slug);
  const profile = await getProfile();

  return (
    <AdminShell
      slug={slug}
      gymName={gym.name}
      role={role}
      userName={profile?.full_name ?? profile?.email ?? 'Staff'}
      userInitial={(profile?.full_name ?? profile?.email ?? 'A').charAt(0).toUpperCase()}
    >
      {children}
    </AdminShell>
  );
}
