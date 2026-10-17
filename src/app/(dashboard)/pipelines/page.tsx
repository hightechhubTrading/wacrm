'use client';

import { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Pipeline, PipelineStage, Deal, Tag } from '@/types';
import { stageHasActiveRequiredGroup } from '@/lib/pipelines/group-values';
import { WaitingWorkQueue } from '@/components/jobs/group-work';
import type { DealOwner } from '@/components/pipelines/deal-assignment';
import { loadDealSummaries } from '@/lib/pipelines/deal-summaries';
import { PipelineExplorer } from '@/components/pipelines/pipeline-explorer';
import { useSearchParams } from 'next/navigation';
import { PageIdentity } from '@/components/workspace/page-identity';
import { PipelineSettings } from '@/components/pipelines/pipeline-settings';
import { DealForm } from '@/components/pipelines/deal-form';
import { OrderInfoDialog } from '@/components/pipelines/order-info-dialog';
import { QuotationsDialog } from '@/components/pipelines/quotations-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GitBranch, Plus, ChevronDown, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { GatedButton } from '@/components/ui/gated-button';
import { useTranslations } from 'next-intl';

// Pipeline creation is admin-class (settings-tier write under
// the new RLS); deal creation is operational and only requires
// agent+. The two CTAs gate on different `useCan` capabilities,
// not on different copy.

// Spec-defined seed — name and color per the product spec.
const SPEC_DEFAULT_STAGES = [
  { name: 'New Lead', color: '#3b82f6', position: 0 }, // blue
  { name: 'Info Gathering', color: '#eab308', position: 1 }, // yellow
  { name: 'Site Visit / Measurement', color: '#06b6d4', position: 2 }, // teal
  { name: 'Quotation Sent', color: '#f97316', position: 3 }, // orange
  { name: 'Negotiation', color: '#8b5cf6', position: 4 }, // purple
  { name: 'Won', color: '#22c55e', position: 5 }, // green
];

/** Raw shape returned by the deals query before flattening embedded joins. */
type RawDealContact = NonNullable<Deal['contact']> & {
  contact_tags?: { tags: Tag | null }[];
  contact_custom_values?: {
    value: string | null;
    custom_fields: { field_name: string; ai_collectible: boolean } | null;
  }[];
};
type RawDeal = Omit<Deal, 'contact'> & { contact?: RawDealContact | null };

/**
 * Flattens `contact_tags(tags(*))` onto `contact.tags` and reduces the
 * embedded `contact_custom_values` down to just the AI-collectible fields
 * that actually have a value, exposed as `contact.customValues`. Lets the
 * deal card show a quick snapshot of what the bot has learned about the
 * lead (product, budget, timeline...) without a second round-trip per card.
 */
function normalizeDeal(raw: RawDeal): Deal {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Deal;

  const { contact_tags, contact_custom_values, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
      customValues: (contact_custom_values ?? [])
        .filter((cv) => cv.custom_fields?.ai_collectible && cv.value?.trim())
        .map((cv) => ({
          field_name: cv.custom_fields!.field_name,
          value: cv.value as string,
        })),
    },
  } as Deal;
}

function normalizeDeals(rows: RawDeal[]): Deal[] {
  return rows.map(normalizeDeal);
}

export default function PipelinesPage() {
  const { accountId } = useAuth();
  return (
    <Suspense fallback={<PipelineLoading />}>
      <PipelinesPageInner key={accountId || 'pending'} />
    </Suspense>
  );
}
function PipelineLoading() {
  return (
    <div className="crm-page crm-pipelines-page space-y-6" aria-busy="true">
      <div className="bg-muted h-8 w-48 animate-pulse rounded" />
      <div className="bg-muted h-24 animate-pulse rounded-xl" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <div
            key={item}
            className="bg-muted/50 h-80 animate-pulse rounded-xl"
          />
        ))}
      </div>
    </div>
  );
}
function PipelinesPageInner() {
  const t = useTranslations('Pipelines.page');
  const searchParams = useSearchParams();
  const explorerCopy = useTranslations('Pipelines.explorer');
  const usefulTitle = useTranslations('Workspace')('pipelines');
  const supabase = createClient();
  const canEditSettings = useCan('edit-settings');
  const canCreateDeals = useCan('send-messages');
  const { accountId, accountRole, profile } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>(
    searchParams.get('pipeline') || ''
  );
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialError, setInitialError] = useState(false);
  const [dealsError, setDealsError] = useState(false);
  const [loadedPipelineId, setLoadedPipelineId] = useState('');
  const [reloadVersion, setReloadVersion] = useState(0);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>('');

  // Order Info popup — opens two ways: as a convenience nudge when a
  // deal moves into a stage with an active custom field group linked
  // (migration 046), or automatically when the move route rejects a
  // move because required fields are still empty (missingFieldIds set,
  // highlighting exactly what's missing instead of leaving the agent
  // with only a toast to act on).
  const [orderInfoState, setOrderInfoState] = useState<{
    deal: Deal;
    missingFieldIds?: string[];
  } | null>(null);

  // Quotations popup (Task 14) — same lifted open/close pattern as
  // orderInfoState above: the deal-card entry point only ever calls
  // back up to here, the dialog itself carries no open state of its own.
  const [quotationsDeal, setQuotationsDeal] = useState<Deal | null>(null);

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);
  const movingDeals = useRef(new Set<string>());

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from('pipelines')
      .select('*')
      .order('created_at');
    if (error) {
      console.error('Failed to load pipelines:', error.message);
      throw error;
    }
    return data ?? [];
  }, [supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', pipelineId)
        .order('position');
      if (error) throw error;
      return data ?? [];
    },
    [supabase]
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      const rows: RawDeal[] = [];
      const batchSize = 500;
      for (let offset = 0; ; offset += batchSize) {
        const { data, error } = await supabase
          .from('deals')
          .select(
            '*, contact:contacts(*, contact_tags(tags(*)), contact_custom_values(value, custom_fields(field_name, ai_collectible))), assignee:profiles!deals_assigned_to_fkey(*)'
          )
          .eq('pipeline_id', pipelineId)
          .order('created_at', { ascending: false })
          .order('id')
          .range(offset, offset + batchSize - 1);
        if (error) throw error;
        rows.push(...((data ?? []) as RawDeal[]));
        if (!data || data.length < batchSize) break;
      }
      const normalized = normalizeDeals(rows);
      return loadDealSummaries(supabase, normalized).catch(() =>
        normalized.map((deal) => ({
          ...deal,
          aiSummary: null,
          aiSummaryUnavailable: true,
          conversationOwnerUnavailable: true,
        }))
      );
    },
    [supabase]
  );

  const seedDefaultPipeline =
    useCallback(async (): Promise<Pipeline | null> => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return null;
      // pipelines.account_id is NOT NULL post-017 with no DB default.
      if (!accountId) return null;

      const { data: pipeline, error } = await supabase
        .from('pipelines')
        .insert({
          user_id: user.id,
          account_id: accountId,
          name: 'Sales Pipeline',
        })
        .select()
        .single();

      if (error || !pipeline) {
        console.error('Failed to seed pipeline:', error?.message);
        return null;
      }

      const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
        pipeline_id: pipeline.id,
        name: s.name,
        color: s.color,
        position: s.position,
      }));
      await supabase.from('pipeline_stages').insert(stagesPayload);

      return pipeline as Pipeline;
    }, [supabase, accountId]);

  // Initial load + seed-if-empty
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setInitialError(false);
      try {
        let list = await loadPipelines();

        if (canEditSettings && list.length === 0 && !seedAttempted.current) {
          seedAttempted.current = true;
          const seeded = await seedDefaultPipeline();
          if (seeded) list = await loadPipelines();
        }

        if (cancelled) return;
        setPipelines(list);
        if (list.length > 0) {
          setSelectedPipelineId((prev) =>
            prev && list.some((p) => p.id === prev) ? prev : list[0].id
          );
        } else {
          setSelectedPipelineId('');
        }
      } catch {
        if (!cancelled) setInitialError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    loadPipelines,
    seedDefaultPipeline,
    accountId,
    canEditSettings,
    reloadVersion,
  ]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      setStages([]);
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setDealsError(false);
      try {
        const [s, d] = await Promise.all([
          loadStages(selectedPipelineId),
          loadDeals(selectedPipelineId),
        ]);
        if (cancelled) return;
        setStages(s);
        setDeals(d);
        setLoadedPipelineId(selectedPipelineId);
      } catch {
        if (!cancelled) setDealsError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals, reloadVersion]);

  const refreshPipelines = useCallback(async () => {
    try {
      const list = await loadPipelines();
      setPipelines(list);
      if (list.length === 0) setSelectedPipelineId('');
      else if (!list.some((pipeline) => pipeline.id === selectedPipelineId))
        setSelectedPipelineId(list[0].id);
    } catch {
      toast.error(explorerCopy('loadError'));
    }
  }, [loadPipelines, selectedPipelineId, explorerCopy]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    try {
      setStages(await loadStages(selectedPipelineId));
    } catch {
      toast.error(explorerCopy('loadError'));
    }
  }, [loadStages, selectedPipelineId, explorerCopy]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    try {
      setDeals(await loadDeals(selectedPipelineId));
    } catch {
      toast.error(explorerCopy('loadError'));
    }
  }, [loadDeals, selectedPipelineId, explorerCopy]);

  const dealsRef = useRef(deals);
  useEffect(() => {
    dealsRef.current = deals;
  }, [deals]);
  useEffect(() => {
    if (!accountId || !selectedPipelineId) return;
    const channel = supabase
      .channel(
        `pipeline-conversation-owners:${accountId}:${selectedPipelineId}`
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          if (!('assigned_agent_id' in payload.new)) return;
          const owner =
            typeof payload.new.assigned_agent_id === 'string'
              ? payload.new.assigned_agent_id
              : null;
          if (
            dealsRef.current.some(
              (deal) =>
                (deal.customerConversationId || deal.conversation_id) ===
                  payload.new.id && deal.conversationOwner?.userId !== owner
            )
          )
            void refreshDeals();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [accountId, selectedPipelineId, supabase, refreshDeals]);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      const original = deals.find((deal) => deal.id === dealId);
      if (
        !original ||
        !canCreateDeals ||
        movingDeals.current.has(dealId) ||
        original.stage_id === newStageId
      )
        return;
      if (
        accountRole !== 'owner' &&
        accountRole !== 'admin' &&
        (!profile?.id || original.assigned_to !== profile.id)
      )
        return;
      movingDeals.current.add(dealId);
      const rollback = () =>
        setDeals((current) =>
          current.map((deal) =>
            deal.id === dealId ? { ...deal, stage_id: original.stage_id } : deal
          )
        );
      try {
        // Optimistic update — board already animated; just persist.
        setDeals((prev) =>
          prev.map((d) =>
            d.id === dealId ? { ...d, stage_id: newStageId } : d
          )
        );

        let res: Response;
        try {
          res = await fetch(`/api/pipelines/deals/${dealId}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stage_id: newStageId }),
          });
        } catch {
          rollback();
          toast.error(t('toastFailedMoveDeal'));
          refreshDeals();
          return;
        }

        if (!res.ok) {
          rollback();
          const data = await res.json().catch(() => null);
          if (
            data?.code === 'missing_required_fields' &&
            Array.isArray(data.fields)
          ) {
            const names = data.fields
              .map((f: { name: string }) => f.name)
              .join(', ');
            toast.error(
              names
                ? t('toastMissingRequiredFields', { fields: names })
                : t('toastFailedMoveDeal')
            );
            // Don't leave the agent with only a toast — open the same
            // Order Info popup with exactly the rejected fields
            // highlighted, so fixing it is one step instead of a
            // separate trip to find where "Location" even lives.
            const blockedDeal = deals.find((d) => d.id === dealId);
            if (blockedDeal) {
              setOrderInfoState({
                deal: blockedDeal,
                missingFieldIds: data.fields.map((f: { id: string }) => f.id),
              });
            }
          } else {
            toast.error(data?.error || t('toastFailedMoveDeal'));
          }
          refreshDeals();
          return;
        }

        // Convenience nudge, not a blocking modal — open the Order Info
        // popup when the deal just entered a stage with an active custom
        // field group linked (migration 046), pre-filled with whatever's
        // already known. Reads the deal from local state (already
        // optimistically updated above) rather than re-fetching.
        const hasGroup = await stageHasActiveRequiredGroup(
          supabase,
          newStageId
        );
        if (hasGroup) {
          const movedDeal = deals.find((d) => d.id === dealId);
          if (movedDeal)
            setOrderInfoState({ deal: { ...movedDeal, stage_id: newStageId } });
        }
      } finally {
        movingDeals.current.delete(dealId);
      }
    },
    [refreshDeals, t, deals, supabase, canCreateDeals, accountRole, profile?.id]
  );

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? '');
      setDealFormOpen(true);
    },
    [stages]
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  const handleOpenQuotations = useCallback((deal: Deal) => {
    setQuotationsDeal(deal);
  }, []);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setCreating(false);
      return;
    }
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) {
      toast.error(t('toastNotLinkedToAccount'));
      setCreating(false);
      return;
    }

    const { data: pipeline, error } = await supabase
      .from('pipelines')
      .insert({ user_id: user.id, account_id: accountId, name })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error(t('toastFailedCreatePipeline'));
      setCreating(false);
      return;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from('pipeline_stages').insert(stagesPayload);

    setNewPipelineName('');
    setNewPipelineOpen(false);
    setSelectedPipelineId(pipeline.id);
    await refreshPipelines();
    setCreating(false);
    toast.success(t('toastPipelineCreated'));
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  if (loading) return <PipelineLoading />;
  if (initialError)
    return (
      <div role="alert" className="crm-pipeline-empty">
        <p>{explorerCopy('loadError')}</p>
        <Button
          variant="outline"
          onClick={() => setReloadVersion((version) => version + 1)}
        >
          {explorerCopy('retry')}
        </Button>
      </div>
    );

  return (
    <div className="crm-page crm-pipelines-page space-y-6">
      <PageIdentity icon={GitBranch}>
        <h1>{usefulTitle}</h1>
        <p className="text-muted-foreground mt-1 max-w-[70ch] text-sm leading-relaxed">
          {explorerCopy('description')}
        </p>
      </PageIdentity>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* Pipeline selector dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className="border-border bg-card text-foreground hover:bg-muted data-[popup-open]:bg-muted inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors">
              <GitBranch className="text-primary h-4 w-4" />
              <span className="max-w-[55vw] truncate font-semibold">
                {selectedPipeline?.name ?? t('selectPipeline')}
              </span>
              <ChevronDown className="text-muted-foreground h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover text-popover-foreground w-64"
            >
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  {t('noPipelinesYet')}
                </DropdownMenuItem>
              )}
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={
                    p.id === selectedPipelineId
                      ? 'text-primary'
                      : 'text-popover-foreground'
                  }
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-border" />
              {canEditSettings && (
                <DropdownMenuItem onClick={() => setNewPipelineOpen(true)}>
                  <Plus className="size-4" />
                  {t('addPipeline')}
                </DropdownMenuItem>
              )}
              {selectedPipeline && (
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  className="text-popover-foreground"
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  {t('managePipelines')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() =>
              selectedPipeline
                ? setSettingsOpen(true)
                : setNewPipelineOpen(true)
            }
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Settings className="me-1 h-4 w-4" />
            {selectedPipeline ? explorerCopy('manageStages') : t('addPipeline')}
          </GatedButton>
          <GatedButton
            canAct={canCreateDeals}
            gateReason="create deals"
            disabled={
              !selectedPipelineId ||
              loadedPipelineId !== selectedPipelineId ||
              stages.length === 0
            }
            onClick={() => handleAddDeal()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('addDeal')}
          </GatedButton>
        </div>
      </div>

      {/* Board */}
      {pipelines.length === 0 ? (
        <div className="border-border flex flex-col items-center justify-center rounded-xl border border-dashed py-20">
          <GitBranch className="text-muted-foreground h-12 w-12" />
          <h3 className="text-foreground mt-4 text-lg font-medium">
            {t('noPipelinesYet')}
          </h3>
          <p className="text-muted-foreground mt-2 text-sm">
            {t('createToStartTracking')}
          </p>
          <GatedButton
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('createPipeline')}
          </GatedButton>
        </div>
      ) : (
        <>
          {dealsError ? (
            <div role="alert" className="crm-pipeline-empty">
              <p>{explorerCopy('loadError')}</p>
              <Button
                variant="outline"
                onClick={() => setReloadVersion((version) => version + 1)}
              >
                {explorerCopy('retry')}
              </Button>
            </div>
          ) : loadedPipelineId !== selectedPipelineId ? (
            <PipelineLoading />
          ) : (
            <PipelineExplorer
              onDealAssigned={(id: string, owner: DealOwner | null) =>
                setDeals((current) => {
                  const selected = current.find((deal) => deal.id === id);
                  const conversationId =
                    selected?.customerConversationId ||
                    selected?.conversation_id;
                  return current.map((deal) => {
                    if (
                      conversationId &&
                      (deal.customerConversationId || deal.conversation_id) ===
                        conversationId
                    )
                      return {
                        ...deal,
                        conversationOwner: {
                          userId: owner?.user_id || null,
                          profileId: owner?.id || null,
                          fullName: owner?.full_name || null,
                          avatarUrl: owner?.avatar_url || null,
                        },
                      };
                    if (!conversationId && deal.id === id)
                      return {
                        ...deal,
                        assigned_to: owner?.id,
                        assignee: owner
                          ? ({ ...deal.assignee, ...owner } as NonNullable<
                              Deal['assignee']
                            >)
                          : undefined,
                      };
                    return deal;
                  });
                })
              }
              key={selectedPipelineId}
              pipelineId={selectedPipelineId}
              onRefresh={async () => {
                await Promise.all([refreshDeals(), refreshStages()]);
              }}
              stages={stages}
              deals={deals}
              onDealMoved={handleDealMoved}
              onAddDeal={handleAddDeal}
              onEditDeal={handleEditDeal}
              onOpenQuotations={handleOpenQuotations}
            />
          )}
          <WaitingWorkQueue />
        </>
      )}

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('newPipeline')}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-muted-foreground">{t('pipelineName')}</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder={t('pipelineNamePlaceholder')}
              className="bg-muted border-border text-foreground mt-2"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreatePipeline();
              }}
            />
            <p className="text-muted-foreground mt-2 text-xs">
              {t('defaultStagesDesc')}
            </p>
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? t('creating') : t('createPipelineBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />

      {/* Order Info popup — see handleDealMoved above */}
      {orderInfoState && (
        <OrderInfoDialog
          open={!!orderInfoState}
          onOpenChange={(open) => {
            if (!open) setOrderInfoState(null);
          }}
          deal={orderInfoState.deal}
          missingFieldIds={orderInfoState.missingFieldIds}
          onSaved={refreshDeals}
        />
      )}

      {/* Quotations popup — see handleOpenQuotations above */}
      {quotationsDeal && (
        <QuotationsDialog
          open={!!quotationsDeal}
          onOpenChange={(open) => {
            if (!open) setQuotationsDeal(null);
          }}
          dealId={quotationsDeal.id}
          contactId={quotationsDeal.contact_id}
        />
      )}
    </div>
  );
}
