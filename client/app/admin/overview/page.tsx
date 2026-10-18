import { redirect } from 'next/navigation';

/**
 * Legacy route kept so old bookmarks and the previous admin nav do not 404.
 * The overview now lives at /admin.
 */
export default function AdminOverviewRedirect() {
  redirect('/admin');
}
