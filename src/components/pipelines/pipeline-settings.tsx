"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createClient } from "@/lib/supabase/client";
import type { Pipeline, PipelineStage, CustomFieldGroup } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Trash2,
  Plus,
  GripVertical,
  AlertTriangle,
  Bell,
  BellOff,
  ListChecks,
  UserCheck,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const STAGE_COLORS = [
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
];

interface PipelineSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: Pipeline;
  stages: PipelineStage[];
  onPipelinesChanged: () => void;
  onStagesChanged: () => void;
  onCreateNewPipeline: () => void;
}

export function PipelineSettings({
  open,
  onOpenChange,
  pipeline,
  stages,
  onPipelinesChanged,
  onStagesChanged,
  onCreateNewPipeline,
}: PipelineSettingsProps) {
  const t = useTranslations("Pipelines.settings");
  const supabase = createClient();
  const { accountId } = useAuth();
  const canManageFieldGroups = useCan("manage-field-groups");

  const [name, setName] = useState(pipeline.name);
  const [localStages, setLocalStages] = useState<PipelineStage[]>(stages);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState(STAGE_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Which active custom field groups (migration 046) are linked to
  // each stage — a deal can't leave a stage until every REQUIRED field
  // in a linked group has a value (see the move route). Keyed by
  // stage_id -> Set of group_id. Written immediately per-toggle
  // (owner-only per RLS), independent of the batched "Save changes"
  // button below.
  const [fieldGroups, setFieldGroups] = useState<CustomFieldGroup[]>([]);
  const [requiredGroupsByStage, setRequiredGroupsByStage] = useState<
    Record<string, Set<string>>
  >({});

  // Reset form state when the dialog opens or its prop inputs change
  // — legitimate prop-driven sync.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setName(pipeline.name);
    setLocalStages([...stages].sort((a, b) => a.position - b.position));
    setShowDeleteConfirm(false);
  }, [open, pipeline, stages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load the account's active custom field groups + which are already
  // linked per stage, so the "required groups" picker has something to
  // show. Group definitions are owner-managed elsewhere (Settings →
  // Fields & tags); this only reads them to build the picker.
  useEffect(() => {
    if (!open || !accountId || stages.length === 0) return;
    let cancelled = false;
    (async () => {
      const [groupsRes, reqRes] = await Promise.all([
        supabase
          .from("custom_field_groups")
          .select("*")
          .eq("account_id", accountId)
          .eq("is_active", true)
          .order("position"),
        supabase
          .from("stage_required_groups")
          .select("stage_id, group_id")
          .in(
            "stage_id",
            stages.map((s) => s.id),
          ),
      ]);
      if (cancelled) return;
      setFieldGroups((groupsRes.data as CustomFieldGroup[] | null) ?? []);
      const map: Record<string, Set<string>> = {};
      for (const row of reqRes.data ?? []) {
        const key = row.stage_id as string;
        if (!map[key]) map[key] = new Set();
        map[key].add(row.group_id as string);
      }
      setRequiredGroupsByStage(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, stages, supabase]);

  async function handleToggleRequiredGroup(
    stageId: string,
    groupId: string,
    required: boolean,
  ) {
    // Optimistic — this is a small, low-stakes toggle; revert on error.
    setRequiredGroupsByStage((prev) => {
      const next = { ...prev };
      const set = new Set(next[stageId] ?? []);
      if (required) set.add(groupId);
      else set.delete(groupId);
      next[stageId] = set;
      return next;
    });

    const error = required
      ? (
          await supabase
            .from("stage_required_groups")
            .insert({ stage_id: stageId, group_id: groupId })
        ).error
      : (
          await supabase
            .from("stage_required_groups")
            .delete()
            .eq("stage_id", stageId)
            .eq("group_id", groupId)
        ).error;

    if (error) {
      toast.error(t("toastFailedRequiredField"));
      setRequiredGroupsByStage((prev) => {
        const next = { ...prev };
        const set = new Set(next[stageId] ?? []);
        if (required) set.delete(groupId);
        else set.add(groupId);
        next[stageId] = set;
        return next;
      });
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleReorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localStages.findIndex((s) => s.id === active.id);
    const newIndex = localStages.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    setLocalStages(arrayMove(localStages, oldIndex, newIndex));
  }

  async function handleSave() {
    setSaving(true);

    // One upsert for all stages — batches N stage writes into a single
    // round-trip. Previous implementation did N sequential UPDATEs which
    // latency-scaled linearly with stage count.
    const stageRows = localStages.map((s, i) => ({
      id: s.id,
      pipeline_id: s.pipeline_id,
      name: s.name,
      color: s.color,
      position: i,
      notify_group_on_enter: s.notify_group_on_enter ?? false,
      requires_contact_identity: s.requires_contact_identity ?? false,
    }));

    const [renameRes, stagesRes] = await Promise.all([
      supabase
        .from("pipelines")
        .update({ name: name.trim() })
        .eq("id", pipeline.id),
      supabase.from("pipeline_stages").upsert(stageRows, { onConflict: "id" }),
    ]);

    setSaving(false);

    if (renameRes.error || stagesRes.error) {
      toast.error(t("toastFailedSave"));
      return;
    }

    onOpenChange(false);
    onPipelinesChanged();
    onStagesChanged();
    toast.success(t("toastSaved"));
  }

  async function handleAddStage() {
    const trimmed = newStageName.trim();
    if (!trimmed) return;
    const { data, error } = await supabase
      .from("pipeline_stages")
      .insert({
        pipeline_id: pipeline.id,
        name: trimmed,
        color: newStageColor,
        position: localStages.length,
      })
      .select()
      .single();
    if (error || !data) {
      toast.error(t("toastFailedAddStage"));
      return;
    }
    setLocalStages([...localStages, data as PipelineStage]);
    setNewStageName("");
    setNewStageColor(STAGE_COLORS[(localStages.length + 1) % STAGE_COLORS.length]);
  }

  async function handleRemoveStage(stageId: string) {
    // Refuse to delete if deals still reference the stage (FK would fail).
    const { count } = await supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("stage_id", stageId);
    if (count && count > 0) {
      toast.error(t("toastMoveOrDeleteDeals"));
      return;
    }
    const { error } = await supabase
      .from("pipeline_stages")
      .delete()
      .eq("id", stageId);
    if (error) {
      toast.error(t("toastFailedDeleteStage"));
      return;
    }
    setLocalStages(localStages.filter((s) => s.id !== stageId));
  }

  async function handleDeletePipeline() {
    setDeleting(true);
    // ON DELETE CASCADE handles deals + stages.
    const { error } = await supabase
      .from("pipelines")
      .delete()
      .eq("id", pipeline.id);
    setDeleting(false);
    if (error) {
      toast.error(t("toastFailedDeletePipeline"));
      return;
    }
    onOpenChange(false);
    onPipelinesChanged();
    toast.success(t("toastDeleted"));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("managePipeline")}</DialogTitle>
        </DialogHeader>

        {showDeleteConfirm ? (
          <div className="py-4">
            <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="text-sm font-medium text-red-400">
                  {t("deletePipeline")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("deletePipelineDesc")}
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                className="border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleDeletePipeline}
                disabled={deleting}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {deleting ? t("deleting") : t("deletePipelineBtn")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("pipelineName")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="border-border bg-muted text-foreground"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("stages")}</Label>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleReorder}
                >
                  <SortableContext
                    items={localStages.map((s) => s.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {localStages.map((stage, index) => (
                        <SortableStageRow
                          key={stage.id}
                          stage={stage}
                          onNameChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = { ...updated[index], name: v };
                            setLocalStages(updated);
                          }}
                          onColorChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = { ...updated[index], color: v };
                            setLocalStages(updated);
                          }}
                          onNotifyChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = {
                              ...updated[index],
                              notify_group_on_enter: v,
                            };
                            setLocalStages(updated);
                          }}
                          onRequiresContactIdentityChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = {
                              ...updated[index],
                              requires_contact_identity: v,
                            };
                            setLocalStages(updated);
                          }}
                          onRemove={() => handleRemoveStage(stage.id)}
                          colors={STAGE_COLORS}
                          t={t}
                          canManageFieldGroups={canManageFieldGroups}
                          fieldGroups={fieldGroups}
                          requiredGroupIds={requiredGroupsByStage[stage.id] ?? new Set()}
                          onToggleRequiredGroup={(groupId, required) =>
                            handleToggleRequiredGroup(stage.id, groupId, required)
                          }
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>

                {/* Add new stage */}
                <div className="mt-1 flex flex-wrap gap-1">
                  {STAGE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewStageColor(color)}
                      className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: color,
                        borderColor:
                          newStageColor === color
                            ? "var(--foreground)"
                            : "transparent",
                      }}
                      aria-label={`Pick color ${color}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={newStageName}
                    onChange={(e) => setNewStageName(e.target.value)}
                    placeholder={t("newStageNamePlaceholder")}
                    className="border-border bg-muted text-sm text-foreground"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddStage();
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddStage}
                    disabled={!newStageName.trim()}
                    className="shrink-0 border-border bg-transparent text-muted-foreground hover:bg-muted"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    {t("add")}
                  </Button>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={onCreateNewPipeline}
                className="w-full border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                <Plus className="mr-1 h-3 w-3" />
                {t("createNewPipeline")}
              </Button>
            </div>

            <DialogFooter className="border-border bg-popover/50">
              <Button
                variant="destructive"
                onClick={() => setShowDeleteConfirm(true)}
                className="mr-auto bg-red-600 hover:bg-red-700"
              >
                {t("deletePipeline")}
              </Button>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !name.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("saving") : t("saveChanges")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SortableStageRow({
  stage,
  onNameChange,
  onColorChange,
  onNotifyChange,
  onRequiresContactIdentityChange,
  onRemove,
  colors,
  t,
  canManageFieldGroups,
  fieldGroups,
  requiredGroupIds,
  onToggleRequiredGroup,
}: {
  stage: PipelineStage;
  onNameChange: (v: string) => void;
  onColorChange: (v: string) => void;
  onNotifyChange: (v: boolean) => void;
  onRequiresContactIdentityChange: (v: boolean) => void;
  onRemove: () => void;
  colors: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
  canManageFieldGroups: boolean;
  fieldGroups: CustomFieldGroup[];
  requiredGroupIds: Set<string>;
  onToggleRequiredGroup: (groupId: string, required: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stage.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-lg border border-border bg-muted p-2"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label={t("dragToReorder")}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <ColorSwatch value={stage.color} onChange={onColorChange} colors={colors} t={t} />
      <Input
        value={stage.name}
        onChange={(e) => onNameChange(e.target.value)}
        className="h-7 flex-1 border-transparent bg-transparent text-sm text-foreground focus:border-border"
      />
      {canManageFieldGroups && (
        <>
          <RequiredGroupsPopover
            fieldGroups={fieldGroups}
            requiredGroupIds={requiredGroupIds}
            onToggle={onToggleRequiredGroup}
            t={t}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onRequiresContactIdentityChange(!stage.requires_contact_identity)}
            title={t("requiresContactIdentity")}
            className={
              stage.requires_contact_identity
                ? "text-primary hover:text-primary"
                : "text-muted-foreground hover:text-foreground"
            }
          >
            {stage.requires_contact_identity ? (
              <UserCheck className="h-3.5 w-3.5" />
            ) : (
              <UserX className="h-3.5 w-3.5" />
            )}
          </Button>
        </>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => onNotifyChange(!stage.notify_group_on_enter)}
        title={t("notifyGroupOnEnter")}
        className={
          stage.notify_group_on_enter
            ? "text-primary hover:text-primary"
            : "text-muted-foreground hover:text-foreground"
        }
      >
        {stage.notify_group_on_enter ? (
          <Bell className="h-3.5 w-3.5" />
        ) : (
          <BellOff className="h-3.5 w-3.5" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        className="text-muted-foreground hover:text-red-400"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

function RequiredGroupsPopover({
  fieldGroups,
  requiredGroupIds,
  onToggle,
  t,
}: {
  fieldGroups: CustomFieldGroup[];
  requiredGroupIds: Set<string>;
  onToggle: (groupId: string, required: boolean) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const count = requiredGroupIds.size;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title={t("requiredFields")}
            className={
              count > 0
                ? "text-primary hover:text-primary"
                : "text-muted-foreground hover:text-foreground"
            }
          />
        }
      >
        <ListChecks className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <p className="text-xs font-medium text-foreground">
          {t("requiredFieldsTitle")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("requiredFieldsDesc")}
        </p>
        {fieldGroups.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("noCustomFields")}
          </p>
        ) : (
          <div className="mt-1 max-h-48 space-y-1.5 overflow-y-auto">
            {fieldGroups.map((group) => (
              <label
                key={group.id}
                className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
              >
                <Checkbox
                  checked={requiredGroupIds.has(group.id)}
                  onCheckedChange={(checked) =>
                    onToggle(group.id, checked === true)
                  }
                />
                {group.name}
              </label>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ColorSwatch({
  value,
  onChange,
  colors,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  colors: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-4 w-4 rounded-full border border-border"
        style={{ backgroundColor: value }}
        aria-label={t("changeColor")}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-6 z-20 flex flex-wrap gap-1 rounded-lg border border-border bg-popover p-2 shadow-lg w-36">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  borderColor:
                    c === value ? "var(--foreground)" : "transparent",
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
