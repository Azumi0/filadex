import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { TableCell } from "@/components/ui/table";
import { Droplet, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { useAuth } from "@/lib/auth";
import { Material, createMaterialSchema } from "./settings-types";
import { SettingsCrudList } from "./settings-crud-list";

const MATERIALS_CSV_FORMAT = `Name,Density,IsHygroscopic
PLA,1.24,false
PETG,1.27,true
ABS,1.04,false
TPU,1.21,false
...`;

// Controlled, not `defaultValue`: a failed save needs to revert what's on
// screen back to the last-confirmed value, or the field keeps showing an
// edit that was never persisted with no sign anything's wrong beyond a toast
// that's easy to miss.
function DensityInput({ value, onSave, ariaLabel }: { value: string | null; onSave: (density: string | null) => Promise<unknown>; ariaLabel: string }) {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  return (
    <Input
      type="number"
      step="0.01"
      min="0"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={async () => {
        const trimmed = draft.trim();
        if (trimmed === (value ?? "")) return;
        try {
          await onSave(trimmed === "" ? null : trimmed);
        } catch {
          setDraft(value ?? "");
        }
      }}
      className="h-8 w-24"
      aria-label={ariaLabel}
    />
  );
}

export function MaterialsList() {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  // Who may act on a row at all: the owner of a Personal Catalog entry, or an
  // admin on any entry. Spelled the same way as the server's `ownsOrIsAdmin`
  // in server/utils/settings-crud.ts, which gates both PUT and DELETE
  // /api/materials/:id - see docs/adr/0003-per-user-material-catalog.md. It
  // governs editing density/isHygroscopic and deleting alike, which is why the
  // one predicate is passed as `canDelete` below.
  const ownsOrIsAdmin = (item: Material) => item.userId === user?.id || isAdmin;

  const updateMutation = useMutation({
    mutationFn: ({ id, ...fields }: { id: number; density?: string | null; isHygroscopic?: boolean }) =>
      apiRequest(`/api/materials/${id}`, { method: "PUT", body: JSON.stringify(fields) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/filaments"] });
    },
    onError: () => {
      toast({ title: t("common.error"), description: t("settings.materials.updateError"), variant: "destructive" });
    },
  });

  return (
    <SettingsCrudList<Material, { name: string; density?: string; isHygroscopic?: boolean }>
      entityKey="materials"
      endpoint="/api/materials"
      entityType="material"
      schema={createMaterialSchema}
      defaultValues={{ name: "", density: "", isHygroscopic: false }}
      reorderable
      layout="table"
      columnHeaders={[t("common.name"), t("settings.materials.density"), t("settings.materials.hygroscopic")]}
      emptyLabelSuffix="noMaterials"
      getSearchText={(item) => item.name}
      canDelete={ownsOrIsAdmin}
      renderAddFields={(form) => (
        <>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("common.name")}</FormLabel>
                <FormControl>
                  <Input placeholder={t("settings.materials.namePlaceholder")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="density"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("settings.materials.density")} (g/cm³)</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" min="0" placeholder="1.24" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="isHygroscopic"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center gap-2 space-y-0">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel className="!mt-0">{t("settings.materials.hygroscopic")}</FormLabel>
              </FormItem>
            )}
          />
        </>
      )}
      renderItemCells={(item) => {
        const editable = ownsOrIsAdmin(item);
        // Exactly the state auto-registration leaves a declared material in
        // when it resolved to nothing (see storage.findOrCreateFilamentType) -
        // the owner was never told this happened, which is the defect this UI
        // closes.
        const needsAttention = item.userId !== null && item.density === null && !item.isHygroscopic;

        return (
          <>
            <TableCell className="py-1 truncate">
              <div className="flex items-center gap-1.5 min-w-0">
                <Badge className="px-2 py-1 theme-primary-bg-20 text-white border-white/20 truncate max-w-full">
                  <span className="truncate" title={item.name}>
                    {item.name}
                  </span>
                </Badge>
              </div>
              <span className="block text-xs text-muted-foreground mt-0.5">
                {item.userId !== null ? t("settings.materials.ownershipOwn") : t("settings.materials.ownershipGlobal")}
              </span>
              {/* On the row, not behind a hover: the defect being fixed is that
                  the user was never told why nothing happened, and a tooltip is
                  invisible on touch and absent from the page itself. */}
              {needsAttention && (
                <p className="flex items-start gap-1.5 mt-1 text-xs text-amber-500 whitespace-normal">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    <span className="font-medium">{t("settings.materials.needsAttention")}</span>{" "}
                    {t("settings.materials.needsAttentionExplanation")}
                  </span>
                </p>
              )}
            </TableCell>
            <TableCell className="py-1 truncate">
              {editable ? (
                <DensityInput
                  value={item.density}
                  onSave={(density) => updateMutation.mutateAsync({ id: item.id, density })}
                  ariaLabel={t("settings.materials.density")}
                />
              ) : (
                item.density ?? "-"
              )}
            </TableCell>
            <TableCell className="py-1 truncate">
              {editable ? (
                <Checkbox
                  checked={!!item.isHygroscopic}
                  onCheckedChange={(checked) => updateMutation.mutate({ id: item.id, isHygroscopic: !!checked })}
                  aria-label={t("settings.materials.hygroscopic")}
                />
              ) : (
                item.isHygroscopic && <Droplet className="h-4 w-4 text-blue-400" />
              )}
            </TableCell>
          </>
        );
      }}
      csvFormat={MATERIALS_CSV_FORMAT}
      csvFields={["name", "density", "isHygroscopic"]}
    />
  );
}
