"use client";

import { Dialog } from "@calcom/features/components/controlled-dialog";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import slugify from "@calcom/lib/slugify";
import { trpc } from "@calcom/trpc/react";
import useMeQuery from "@calcom/trpc/react/hooks/useMeQuery";
import { Button } from "@calcom/ui/components/button";
import { DialogContent, DialogFooter } from "@calcom/ui/components/dialog";
import { Form, Label, TextAreaField, TextField } from "@calcom/ui/components/form";
import { showToast } from "@calcom/ui/components/toast";
import { TimezoneSelect } from "@calcom/web/modules/timezone/components/TimezoneSelect";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

type FormValues = { name: string; slug: string; timeZone: string; bio: string };

export function CreateTeamDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: me } = useMeQuery();
  const [slugEdited, setSlugEdited] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormValues>({ defaultValues: { name: "", slug: "", timeZone: "", bio: "" } });
  const timeZone = form.watch("timeZone") || me?.timeZone || "";

  const createTeam = trpc.viewer.teams.create.useMutation({
    onSuccess: async (team) => {
      showToast(t("team_created_successfully"), "success");
      await utils.viewer.teams.list.invalidate();
      router.push(`/settings/teams/${team.id}/profile`);
    },
    // The server's message is specific (e.g. the slug is taken), so show it rather than a generic error.
    onError: (err) => setServerError(err.message),
  });

  const nameField = form.register("name", {
    onChange: (event) => {
      if (!slugEdited) form.setValue("slug", slugify(event.target.value));
    },
  });
  const slugField = form.register("slug", { onChange: () => setSlugEdited(true) });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      form.reset();
      setSlugEdited(false);
      setServerError(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent type="creation" title={t("create_new_team")}>
        <Form
          form={form}
          className="stack-y-4"
          handleSubmit={(values) => {
            setServerError(null);
            createTeam.mutate({
              name: values.name,
              ...(values.slug ? { slug: values.slug } : {}),
              ...(timeZone ? { timeZone } : {}),
              ...(values.bio ? { bio: values.bio } : {}),
            });
          }}>
          {/* Above the fields: the dialog body scrolls, so an error below them can be out of view. */}
          {serverError && (
            <p role="alert" className="text-error text-sm">
              {serverError}
            </p>
          )}
          <TextField label={t("team_name")} required maxLength={100} {...nameField} />
          <TextField label={t("team_url")} maxLength={100} {...slugField} />
          <div>
            <Label htmlFor="team-timezone">{t("timezone")}</Label>
            <TimezoneSelect
              inputId="team-timezone"
              value={timeZone}
              onChange={(option) => {
                if (option) form.setValue("timeZone", option.value);
              }}
            />
          </div>
          {/* TextAreaField's label points at an id it never gives the textarea, so link them explicitly. */}
          <TextAreaField
            id="team-bio"
            labelProps={{ htmlFor: "team-bio" }}
            label={t("bio")}
            maxLength={1000}
            {...form.register("bio")}
          />
          <DialogFooter showDivider>
            <Button type="button" color="secondary" onClick={() => handleOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" loading={createTeam.isPending}>
              {t("create")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
