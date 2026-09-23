"use client";

import SettingsHeader from "@calcom/features/settings/appDir/SettingsHeader";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { getPlaceholderAvatar } from "@calcom/lib/defaultAvatarImage";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { RouterOutputs } from "@calcom/trpc/react";
import { trpc } from "@calcom/trpc/react";
import { Avatar } from "@calcom/ui/components/avatar";
import { Button } from "@calcom/ui/components/button";
import { EmptyScreen } from "@calcom/ui/components/empty-screen";
import { Form, Label, TextAreaField, TextField } from "@calcom/ui/components/form";
import { ImageUploader } from "@calcom/ui/components/image-uploader";
import { SkeletonText } from "@calcom/ui/components/skeleton";
import { showToast } from "@calcom/ui/components/toast";
import { TimezoneSelect } from "@calcom/web/modules/timezone/components/TimezoneSelect";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { DeleteTeamSection } from "../components/DeleteTeamSection";
import { canManageTeam } from "../lib/canManageTeam";

type Team = RouterOutputs["viewer"]["teams"]["get"];
type FormValues = { name: string; slug: string; timeZone: string; bio: string; logo: string | null };

// Mirrors the server's validateTeamLogo limit so an oversized logo is caught before upload.
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const decodedSize = (dataUrl: string) => Math.floor(((dataUrl.split(",")[1] ?? "").length * 3) / 4);

function TeamProfileForm({ team, canEdit }: { team: Team; canEdit: boolean }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [serverError, setServerError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    defaultValues: {
      name: team.name,
      slug: team.slug ?? "",
      timeZone: team.timeZone,
      bio: team.bio ?? "",
      logo: team.logoUrl,
    },
  });

  const updateTeam = trpc.viewer.teams.update.useMutation({
    onSuccess: async (updated) => {
      showToast(t("team_updated_successfully"), "success");
      form.reset({
        name: updated.name,
        slug: updated.slug ?? "",
        timeZone: updated.timeZone,
        bio: updated.bio ?? "",
        logo: updated.logoUrl,
      });
      await Promise.all([
        utils.viewer.teams.get.invalidate({ teamId: team.id }),
        utils.viewer.teams.list.invalidate(),
      ]);
    },
    onError: (err) => setServerError(err.message),
  });

  const slug = form.watch("slug");

  return (
    <Form
      form={form}
      className="stack-y-6 rounded-b-lg border border-subtle border-t-0 px-4 py-8 sm:px-6"
      handleSubmit={(values) => {
        setServerError(null);
        const dirty = form.formState.dirtyFields;
        updateTeam.mutate({
          teamId: team.id,
          ...(dirty.name ? { name: values.name } : {}),
          ...(dirty.slug ? { slug: values.slug } : {}),
          ...(dirty.timeZone ? { timeZone: values.timeZone } : {}),
          ...(dirty.bio ? { bio: values.bio || null } : {}),
          ...(dirty.logo ? { logo: values.logo } : {}),
        });
      }}>
      {!canEdit && <p className="text-sm text-subtle">{t("only_team_admins_can_edit_profile")}</p>}
      {serverError && (
        <p role="alert" className="text-error text-sm">
          {serverError}
        </p>
      )}
      <Controller
        control={form.control}
        name="logo"
        render={({ field: { value, onChange } }) => (
          <div className="flex items-center gap-4">
            <Avatar alt={team.name} size="lg" imageSrc={getPlaceholderAvatar(value, team.name)} />
            <div>
              <p className="mb-2 font-medium text-sm">{t("team_logo")}</p>
              {canEdit && (
                <div className="flex gap-2">
                  <ImageUploader
                    target="logo"
                    id="team-logo-upload"
                    buttonMsg={t("upload_logo")}
                    imageSrc={value ?? undefined}
                    handleAvatarChange={(newLogo) => {
                      if (decodedSize(newLogo) > MAX_LOGO_BYTES) {
                        setLogoError(t("team_logo_too_large"));
                        return;
                      }
                      setLogoError(null);
                      onChange(newLogo);
                    }}
                  />
                  {value !== null && (
                    <Button color="minimal" onClick={() => onChange(null)}>
                      {t("remove_logo")}
                    </Button>
                  )}
                </div>
              )}
              {logoError && <p className="mt-1 text-error text-sm">{logoError}</p>}
            </div>
          </div>
        )}
      />
      <TextField
        label={t("team_name")}
        required
        maxLength={100}
        disabled={!canEdit}
        {...form.register("name")}
      />
      <div>
        <TextField label={t("team_url")} maxLength={100} disabled={!canEdit} {...form.register("slug")} />
        <p className="mt-1 text-sm text-subtle">{`${WEBAPP_URL}/team/${slug}`}</p>
      </div>
      <Controller
        control={form.control}
        name="timeZone"
        render={({ field: { value, onChange } }) => (
          <div>
            <Label htmlFor="team-profile-timezone">{t("timezone")}</Label>
            <TimezoneSelect
              id="team-profile-timezone"
              aria-label={t("timezone")}
              value={value}
              isDisabled={!canEdit}
              onChange={(option) => {
                if (option) onChange(option.value);
              }}
            />
          </div>
        )}
      />
      {/* TextAreaField's label points at an id it never gives the textarea, so link them explicitly. */}
      <TextAreaField
        id="team-profile-bio"
        labelProps={{ htmlFor: "team-profile-bio" }}
        label={t("bio")}
        maxLength={1000}
        disabled={!canEdit}
        {...form.register("bio")}
      />
      {canEdit && (
        <div className="flex justify-end">
          <Button type="submit" loading={updateTeam.isPending} disabled={!form.formState.isDirty}>
            {t("update")}
          </Button>
        </div>
      )}
    </Form>
  );
}

export default function TeamProfileView({
  teamId,
  isInstanceAdmin,
}: {
  teamId: number;
  isInstanceAdmin: boolean;
}) {
  const { t } = useLocale();
  // FORBIDDEN and NOT_FOUND are final answers, so don't retry them.
  const { data: team, isPending, error } = trpc.viewer.teams.get.useQuery({ teamId }, { retry: false });
  const { data: teams } = trpc.viewer.teams.list.useQuery();
  const role = teams?.find((listed) => listed.id === teamId)?.role ?? null;

  return (
    <SettingsHeader title={t("profile")} description={t("profile_team_description")} borderInShellHeader>
      {error ? (
        <EmptyScreen
          Icon={error.data?.code === "NOT_FOUND" ? "users" : "lock"}
          headline={t(error.data?.code === "NOT_FOUND" ? "team_not_found" : "dont_have_access_this_page")}
          className="rounded-t-none rounded-b-lg border-t-0"
          buttonRaw={
            <Button color="secondary" href="/settings/teams">
              {t("all_teams")}
            </Button>
          }
        />
      ) : isPending || !team ? (
        <SkeletonText className="h-40 w-full" />
      ) : (
        <>
          <TeamProfileForm key={team.id} team={team} canEdit={canManageTeam({ role }, isInstanceAdmin)} />
          {isInstanceAdmin && <DeleteTeamSection team={team} />}
        </>
      )}
    </SettingsHeader>
  );
}
