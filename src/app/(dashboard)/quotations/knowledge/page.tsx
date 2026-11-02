import { requireRole } from '@/lib/auth/account';
import { KnowledgeLibrary } from '@/components/quotations/knowledge/knowledge-library';
export default async function KnowledgePage() {
  await requireRole('agent');
  return <KnowledgeLibrary />;
}
