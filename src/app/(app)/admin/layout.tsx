import { redirect } from 'next/navigation';
import { HttpError, requireUser } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireUser(['ADMIN']);
    return children;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      redirect('/login?redirectTo=/admin');
    }
    redirect('/scan');
  }
}
