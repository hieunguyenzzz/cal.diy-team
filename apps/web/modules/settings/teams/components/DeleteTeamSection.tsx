"use client";

import { Dialog } from "@calcom/features/components/controlled-dialog";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { DialogContent, DialogFooter } from "@calcom/ui/components/dialog";
import { TextField } from "@calcom/ui/components/form";
import { showToast } from "@calcom/ui/components/toast";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = { team: { id: number; name: string; slug: string | null } };

export function DeleteTeamSection({ team }: Props) {
  const { t } = useLocale();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [isOpen, setIsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const slug = team.slug ?? "";

  // Only counted once the admin opens the dialog, so viewing the profile costs no booking query.
  const upcomingBookings = trpc.viewer.teams.countUpcomingBookings.useQuery(
    { teamId: team.id },
    { enabled: isOpen }
  );
  const deleteTeam = trpc.viewer.teams.delete.useMutation({
    onSuccess: async () => {
      showToast(t("team_deleted_successfully"), "success");
      await utils.viewer.teams.list.invalidate();
      router.push("/settings/teams");
    },
    onError: (err) => setServerError(err.message),
  });

  const canConfirm = confirmation === slug && !upcomingBookings.isPending && !deleteTeam.isPending;

  return (
    <div className="mt-6 rounded-lg border border-error p-6">
      <h3 className="font-semibold text-emphasis text-sm">{t("danger_zone")}</h3>
      <p className="mt-1 text-subtle text-sm">{t("delete_team_description")}</p>
      <Button className="mt-4" color="destructive" StartIcon="trash" onClick={() => setIsOpen(true)}>
        {t("delete_team")}
      </Button>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) setConfirmation("");
        }}>
        <DialogContent type="confirmation" title={t("delete_team")}>
          <div className="stack-y-4">
            {serverError && (
              <p role="alert" className="text-error text-sm">
                {serverError}
              </p>
            )}
            {upcomingBookings.data !== undefined && (
              <p className="text-default text-sm">
                {t("team_upcoming_bookings_warning", { count: upcomingBookings.data })}
              </p>
            )}
            <TextField
              name="confirmTeamSlug"
              label={t("type_team_slug_to_confirm", { slug })}
              value={confirmation}
              autoComplete="off"
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button color="secondary" onClick={() => setIsOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              color="destructive"
              data-testid="confirm-delete-team"
              disabled={!canConfirm}
              loading={deleteTeam.isPending}
              onClick={() => {
                setServerError(null);
                deleteTeam.mutate({ teamId: team.id });
              }}>
              {t("delete_team")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
