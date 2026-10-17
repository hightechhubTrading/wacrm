'use client';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Check,
  ChevronDown,
  Loader2,
  Search,
  UserRound,
  UserRoundPlus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { createClient } from '@/lib/supabase/client';
import { getPipelineOwner } from '@/lib/pipelines/deal-owner';
import type { Deal } from '@/types';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

export interface DealOwner {
  id: string;
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
}
interface People {
  members: DealOwner[];
  loading: boolean;
  failed: boolean;
  busy: string | null;
  retry: () => void;
  assign: (deal: Deal, owner: DealOwner | null) => Promise<boolean>;
}
const PeopleContext = createContext<People | null>(null);
export function PipelinePeopleProvider({
  pipelineId,
  onAssigned,
  children,
}: {
  pipelineId: string;
  onAssigned: (id: string, owner: DealOwner | null) => void;
  children: ReactNode;
}) {
  const t = useTranslations('Pipelines.smartCard');
  const { accountId } = useAuth();
  const db = createClient();
  const canAssign = useCan('edit-settings');
  const [members, setMembers] = useState<DealOwner[]>([]),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [busy, setBusy] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      if (!accountId || !canAssign) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const { data, error } = await db
          .from('profiles')
          .select('id,user_id,full_name,avatar_url')
          .eq('account_id', accountId)
          .in('account_role', ['owner', 'admin', 'agent'])
          .order('full_name')
          .abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (error) throw error;
        setMembers(data || []);
        setFailed(false);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [accountId, canAssign, db, retryVersion]);
  const value = useMemo<People>(
    () => ({
      members,
      loading,
      failed,
      busy,
      retry: () => setRetryVersion((version) => version + 1),
      assign: async (deal, owner) => {
        if (!canAssign || !accountId || busy) return false;
        setBusy(deal.id);
        try {
          const conversationId =
            deal.customerConversationId || deal.conversation_id;
          const query = conversationId
            ? db
                .from('conversations')
                .update({ assigned_agent_id: owner?.user_id || null })
                .eq('id', conversationId)
                .eq('account_id', accountId)
                .select('id,assigned_agent_id')
            : db
                .from('deals')
                .update({ assigned_to: owner?.id || null })
                .eq('id', deal.id)
                .eq('account_id', accountId)
                .eq('pipeline_id', pipelineId)
                .select('id,assigned_to');
          const { data, error } = await query.maybeSingle();
          if (error || !data) throw error || new Error('Missing deal');
          onAssigned(deal.id, owner);
          toast.success(t('assignmentSaved'));
          return true;
        } catch {
          toast.error(t('assignmentFailed'));
          return false;
        } finally {
          setBusy(null);
        }
      },
    }),
    [
      members,
      loading,
      failed,
      busy,
      canAssign,
      accountId,
      db,
      pipelineId,
      onAssigned,
      t,
    ]
  );
  return (
    <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>
  );
}
export function DealAssignment({ deal }: { deal: Deal }) {
  const t = useTranslations('Pipelines.smartCard');
  const people = useContext(PeopleContext);
  const canAssign = useCan('edit-settings');
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const assignment = getPipelineOwner(deal);
  const name = assignment.name || t('teamMember');
  const label = (
    <>
      <span className="crm-owner-avatar">
        {assignment.id ? (
          (assignment.name || '?').charAt(0).toUpperCase()
        ) : (
          <UserRoundPlus className="size-3.5" />
        )}
      </span>
      <span className="truncate">
        {assignment.id ? name : t('assignOwner')}
      </span>
    </>
  );
  if (assignment.unavailable)
    return (
      <span className="crm-deal-owner">
        <UserRound className="size-3.5" />
        {t('ownerUnavailable')}
      </span>
    );
  if (!canAssign || !people)
    return (
      <span className="crm-deal-owner" data-assigned={!!assignment.id}>
        <UserRound className="size-3.5" />
        {assignment.id ? name : t('unassignedOwner')}
      </span>
    );
  const options = people.members.filter((member) =>
    (member.full_name || t('teamMember'))
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase())
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery('');
      }}
    >
      <PopoverTrigger
        disabled={!!people.busy}
        aria-label={t('changeOwner', { title: deal.title })}
        className="crm-deal-owner"
        data-assigned={!!assignment.id}
      >
        {label}
        {people.busy === deal.id ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
        ) : (
          <ChevronDown className="size-3 shrink-0" />
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(320px,calc(100vw-32px))] p-3"
      >
        <p className="text-muted-foreground px-1 text-xs font-medium">
          {t(
            assignment.source === 'conversation'
              ? 'conversationOwner'
              : 'dealOwner'
          )}
        </p>
        <div className="relative">
          <Search className="text-muted-foreground absolute start-3 top-3 size-4" />
          <Input
            autoFocus
            aria-label={t('findMember')}
            placeholder={t('findMember')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 ps-9"
          />
        </div>
        <div className="max-h-60 overflow-y-auto">
          {people.loading ? (
            <p role="status" className="text-muted-foreground p-3 text-sm">
              {t('loadingMembers')}
            </p>
          ) : people.failed ? (
            <p role="alert" className="text-destructive p-3 text-sm">
              {t('membersFailed')}
              <button
                type="button"
                className="text-primary mt-3 block underline"
                onClick={people.retry}
              >
                {t('retryMembers')}
              </button>
            </p>
          ) : (
            <>
              <button
                type="button"
                disabled={!!people.busy}
                className="crm-owner-option"
                onClick={async () => {
                  if (await people.assign(deal, null)) setOpen(false);
                }}
              >
                <UserRoundPlus className="size-4" />
                {t('unassignedOwner')}
                {!assignment.id && <Check className="ms-auto size-4" />}
              </button>
              {options.map((member) => (
                <button
                  type="button"
                  key={member.id}
                  disabled={!!people.busy}
                  className="crm-owner-option"
                  onClick={async () => {
                    if (await people.assign(deal, member)) setOpen(false);
                  }}
                >
                  <span className="crm-owner-avatar">
                    {(member.full_name || '?').charAt(0).toUpperCase()}
                  </span>
                  <span className="truncate">
                    {member.full_name || t('teamMember')}
                  </span>
                  {(assignment.profileId === member.id ||
                    (!!assignment.userId &&
                      assignment.userId === member.user_id)) && (
                    <Check className="text-primary ms-auto size-4" />
                  )}
                </button>
              ))}
              {query && !options.length && (
                <p className="text-muted-foreground p-3 text-sm">
                  {t('noMembers')}
                </p>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
