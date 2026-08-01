"use client";

import { useCallback, useEffect, useState } from "react";
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
import { useAuth } from "@/hooks/use-auth";
import { CUSTOM_FIELD_TYPES } from "@/lib/custom-fields/field-types";
import type { CustomField, CustomFieldGroup, CustomFieldType } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GripVertical,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const SCOPE_OPTIONS: { value: "contact" | "deal"; labelKey: "scopeContact" | "scopeDeal" }[] = [
  { value: "contact", labelKey: "scopeContact" },
  { value: "deal", labelKey: "scopeDeal" },
];

/**
 * Owner-only CRUD for custom field GROUPS (migration 046) — creating,
 * renaming, activating, reordering, and deleting groups, and — within
 * each group — the same for its typed fields (name, type, required,
 * AI-collectible). Replaces the old flat `CustomFieldsPanel` list.
 * Gated by the caller (`useCan("manage-field-groups")`); `owner`-tier
 * RLS on `custom_field_groups`/`custom_fields` enforces it regardless.
 */
export function CustomFieldGroupsPanel() {
  const t = useTranslations("CustomFieldGroups.panel");
  const { user, accountId } = useAuth();

  const [groups, setGroups] = useState<CustomFieldGroup[]>([]);
  const [fieldsByGroup, setFieldsByGroup] = useState<Record<string, CustomField[]>>({});
  const [legacyFields, setLegacyFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupScope, setNewGroupScope] = useState<"contact" | "deal">("contact");
  const [creatingGroup, setCreatingGroup] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const supabase = createClient();
    const [groupsRes, fieldsRes] = await Promise.all([
      supabase
        .from("custom_field_groups")
        .select("*")
        .eq("account_id", accountId)
        .order("position"),
      supabase
        .from("custom_fields")
        .select("*")
        .eq("account_id", accountId)
        .order("position"),
    ]);
    const groupRows = (groupsRes.data as CustomFieldGroup[] | null) ?? [];
    const fieldRows = (fieldsRes.data as CustomField[] | null) ?? [];

    setGroups(groupRows);
    const byGroup: Record<string, CustomField[]> = {};
    const legacy: CustomField[] = [];
    for (const f of fieldRows) {
      if (f.group_id) (byGroup[f.group_id] ??= []).push(f);
      else legacy.push(f);
    }
    setFieldsByGroup(byGroup);
    setLegacyFields(legacy);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  function toggleExpanded(groupId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  async function handleCreateGroup() {
    const name = newGroupName.trim();
    if (!name || !accountId) return;
    setCreatingGroup(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("custom_field_groups")
      .insert({
        account_id: accountId,
        name,
        scope: newGroupScope,
        position: groups.length,
      })
      .select()
      .single();
    setCreatingGroup(false);
    if (error || !data) {
      toast.error(t("toastCreateGroupFailed"));
      return;
    }
    setGroups((prev) => [...prev, data as CustomFieldGroup]);
    setExpanded((prev) => new Set(prev).add((data as CustomFieldGroup).id));
    setNewGroupName("");
  }

  async function handleRenameGroup(group: CustomFieldGroup, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === group.name) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("custom_field_groups")
      .update({ name: trimmed })
      .eq("id", group.id);
    if (error) {
      toast.error(t("toastRenameGroupFailed"));
      await fetchAll();
      return;
    }
    setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, name: trimmed } : g)));
  }

  async function handleToggleActive(group: CustomFieldGroup) {
    const nextActive = !group.is_active;
    setGroups((prev) =>
      prev.map((g) => (g.id === group.id ? { ...g, is_active: nextActive } : g)),
    );
    const supabase = createClient();
    const { error } = await supabase
      .from("custom_field_groups")
      .update({ is_active: nextActive })
      .eq("id", group.id);
    if (error) {
      toast.error(t("toastToggleActiveFailed"));
      setGroups((prev) =>
        prev.map((g) => (g.id === group.id ? { ...g, is_active: group.is_active } : g)),
      );
    }
  }

  async function handleDeleteGroup(group: CustomFieldGroup) {
    if (!window.confirm(t("deleteGroupConfirm", { name: group.name }))) return;
    const supabase = createClient();
    const { error } = await supabase.from("custom_field_groups").delete().eq("id", group.id);
    if (error) {
      toast.error(t("toastDeleteGroupFailed"));
      return;
    }
    setGroups((prev) => prev.filter((g) => g.id !== group.id));
    toast.success(t("toastGroupDeleted", { name: group.name }));
  }

  async function handleReorderGroups(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = groups.findIndex((g) => g.id === active.id);
    const newIndex = groups.findIndex((g) => g.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(groups, oldIndex, newIndex);
    setGroups(reordered);
    const supabase = createClient();
    await supabase
      .from("custom_field_groups")
      .upsert(
        reordered.map((g, i) => ({ id: g.id, account_id: g.account_id, name: g.name, scope: g.scope, is_active: g.is_active, position: i })),
        { onConflict: "id" },
      );
  }

  async function handleAddField(groupId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed || !accountId || !user) return;
    const supabase = createClient();
    const existing = fieldsByGroup[groupId] ?? [];
    const { data, error } = await supabase
      .from("custom_fields")
      .insert({
        account_id: accountId,
        user_id: user.id,
        field_name: trimmed,
        field_type: "text",
        group_id: groupId,
        required: false,
        position: existing.length,
      })
      .select()
      .single();
    if (error || !data) {
      toast.error(t("toastAddFieldFailed"));
      return;
    }
    setFieldsByGroup((prev) => ({
      ...prev,
      [groupId]: [...(prev[groupId] ?? []), data as CustomField],
    }));
  }

  function updateFieldLocal(groupId: string, fieldId: string, patch: Partial<CustomField>) {
    setFieldsByGroup((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] ?? []).map((f) => (f.id === fieldId ? { ...f, ...patch } : f)),
    }));
  }

  async function handleFieldPatch(groupId: string, field: CustomField, patch: Partial<CustomField>) {
    updateFieldLocal(groupId, field.id, patch);
    const supabase = createClient();
    const { error } = await supabase.from("custom_fields").update(patch).eq("id", field.id);
    if (error) {
      toast.error(t("toastUpdateFieldFailed"));
      updateFieldLocal(groupId, field.id, field);
    }
  }

  async function handleDeleteField(groupId: string, field: CustomField) {
    if (!window.confirm(t("deleteFieldConfirm", { name: field.field_name }))) return;
    const supabase = createClient();
    const { error } = await supabase.from("custom_fields").delete().eq("id", field.id);
    if (error) {
      toast.error(t("toastDeleteFieldFailed"));
      return;
    }
    setFieldsByGroup((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] ?? []).filter((f) => f.id !== field.id),
    }));
  }

  async function handleReorderFields(groupId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fields = fieldsByGroup[groupId] ?? [];
    const oldIndex = fields.findIndex((f) => f.id === active.id);
    const newIndex = fields.findIndex((f) => f.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(fields, oldIndex, newIndex);
    setFieldsByGroup((prev) => ({ ...prev, [groupId]: reordered }));
    const supabase = createClient();
    await supabase
      .from("custom_fields")
      .upsert(
        reordered.map((f, i) => ({
          id: f.id,
          account_id: f.account_id,
          user_id: f.user_id,
          field_name: f.field_name,
          field_type: f.field_type,
          group_id: f.group_id,
          required: f.required,
          position: i,
        })),
        { onConflict: "id" },
      );
  }

  async function handleRenameLegacyField(field: CustomField, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === field.field_name) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("custom_fields")
      .update({ field_name: trimmed })
      .eq("id", field.id);
    if (error) {
      toast.error(t("toastUpdateFieldFailed"));
      await fetchAll();
      return;
    }
    setLegacyFields((prev) => prev.map((f) => (f.id === field.id ? { ...f, field_name: trimmed } : f)));
  }

  async function handleDeleteLegacyField(field: CustomField) {
    if (!window.confirm(t("deleteFieldConfirm", { name: field.field_name }))) return;
    const supabase = createClient();
    const { error } = await supabase.from("custom_fields").delete().eq("id", field.id);
    if (error) {
      toast.error(t("toastDeleteFieldFailed"));
      return;
    }
    setLegacyFields((prev) => prev.filter((f) => f.id !== field.id));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleReorderGroups}>
        <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {groups.map((group) => (
              <SortableGroupRow
                key={group.id}
                group={group}
                fields={(fieldsByGroup[group.id] ?? []).slice().sort((a, b) => a.position - b.position)}
                expanded={expanded.has(group.id)}
                onToggleExpanded={() => toggleExpanded(group.id)}
                onRename={(name) => handleRenameGroup(group, name)}
                onToggleActive={() => handleToggleActive(group)}
                onDelete={() => handleDeleteGroup(group)}
                onAddField={(name) => handleAddField(group.id, name)}
                onFieldPatch={(field, patch) => handleFieldPatch(group.id, field, patch)}
                onDeleteField={(field) => handleDeleteField(group.id, field)}
                onReorderFields={(event) => handleReorderFields(group.id, event)}
                sensors={sensors}
                t={t}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noGroupsYet")}</p>
      )}

      {/* Create group */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-3">
        <Input
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          placeholder={t("newGroupNamePlaceholder")}
          className="h-8 flex-1 min-w-40 border-border bg-muted text-sm text-foreground"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreateGroup();
          }}
        />
        <div className="flex overflow-hidden rounded-md border border-border">
          {SCOPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setNewGroupScope(opt.value)}
              className={
                "px-2.5 py-1.5 text-xs font-medium transition-colors " +
                (newGroupScope === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground")
              }
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleCreateGroup}
          disabled={creatingGroup || !newGroupName.trim()}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {creatingGroup ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          {t("createGroup")}
        </Button>
      </div>

      {/* Legacy ungrouped fields */}
      {legacyFields.length > 0 && (
        <div className="space-y-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("legacyFieldsTitle")}
            </p>
            <p className="text-xs text-muted-foreground">{t("legacyFieldsDesc")}</p>
          </div>
          <ul className="divide-y divide-border rounded-md border border-border">
            {legacyFields.map((field) => (
              <LegacyFieldRow
                key={field.id}
                field={field}
                onRename={(name) => handleRenameLegacyField(field, name)}
                onDelete={() => handleDeleteLegacyField(field)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SortableGroupRow({
  group,
  fields,
  expanded,
  onToggleExpanded,
  onRename,
  onToggleActive,
  onDelete,
  onAddField,
  onFieldPatch,
  onDeleteField,
  onReorderFields,
  sensors,
  t,
}: {
  group: CustomFieldGroup;
  fields: CustomField[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onRename: (name: string) => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onAddField: (name: string) => void;
  onFieldPatch: (field: CustomField, patch: Partial<CustomField>) => void;
  onDeleteField: (field: CustomField) => void;
  onReorderFields: (event: DragEndEvent) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sensors: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
  });
  const [name, setName] = useState(group.name);
  const [newFieldName, setNewFieldName] = useState("");

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border border-border bg-muted/40">
      <div className="flex items-center gap-2 p-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label={t("dragToReorder")}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggleExpanded}
          className="text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onRename(name)}
          className="h-7 flex-1 border-transparent bg-transparent text-sm font-medium text-foreground focus:border-border"
        />
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {group.scope === "deal" ? t("scopeDeal") : t("scopeContact")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onToggleActive}
          title={group.is_active ? t("activeOnSidebar") : t("hiddenFromSidebar")}
          className={group.is_active ? "text-primary hover:text-primary" : "text-muted-foreground hover:text-foreground"}
        >
          {group.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onDelete}
          className="text-muted-foreground hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-border/60 p-2 ps-8">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorderFields}>
            <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {fields.map((field) => (
                  <SortableFieldRow
                    key={field.id}
                    field={field}
                    onPatch={(patch) => onFieldPatch(field, patch)}
                    onDelete={() => onDeleteField(field)}
                    t={t}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {fields.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("noFieldsYet")}</p>
          )}

          <div className="flex items-center gap-2">
            <Input
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
              placeholder={t("newFieldNamePlaceholder")}
              className="h-7 flex-1 border-border bg-muted text-xs text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onAddField(newFieldName);
                  setNewFieldName("");
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 shrink-0 border-border bg-transparent text-muted-foreground hover:bg-muted"
              disabled={!newFieldName.trim()}
              onClick={() => {
                onAddField(newFieldName);
                setNewFieldName("");
              }}
            >
              <Plus className="h-3 w-3" />
              {t("addField")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableFieldRow({
  field,
  onPatch,
  onDelete,
  t,
}: {
  field: CustomField;
  onPatch: (patch: Partial<CustomField>) => void;
  onDelete: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  });
  const [name, setName] = useState(field.field_name);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label={t("dragToReorder")}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const trimmed = name.trim();
          if (trimmed && trimmed !== field.field_name) onPatch({ field_name: trimmed });
          else setName(field.field_name);
        }}
        className="h-7 min-w-24 flex-1 border-transparent bg-transparent text-xs text-foreground focus:border-border"
      />
      <Select
        value={field.field_type}
        onValueChange={(v) => onPatch({ field_type: v as CustomFieldType })}
      >
        <SelectTrigger className="h-7 w-28 border-border bg-muted text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CUSTOM_FIELD_TYPES.map((ft) => (
            <SelectItem key={ft} value={ft} className="text-xs">
              {t(`fieldType_${ft}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Checkbox
          checked={field.required}
          onCheckedChange={(checked) => onPatch({ required: checked === true })}
        />
        {t("required")}
      </label>
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Checkbox
          checked={field.ai_collectible ?? false}
          onCheckedChange={(checked) => onPatch({ ai_collectible: checked === true })}
        />
        {t("aiCollectible")}
      </label>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onDelete}
        className="ms-auto shrink-0 text-muted-foreground hover:text-red-400"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

function LegacyFieldRow({
  field,
  onRename,
  onDelete,
}: {
  field: CustomField;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(field.field_name);
  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim() && name.trim() !== field.field_name) onRename(name);
          else setName(field.field_name);
        }}
        className="h-8 flex-1 border-transparent bg-transparent text-foreground hover:border-border focus:border-primary"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onDelete}
        className="shrink-0 text-muted-foreground hover:text-red-400"
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}
