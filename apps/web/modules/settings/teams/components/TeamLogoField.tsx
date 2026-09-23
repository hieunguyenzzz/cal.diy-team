"use client";

import { MAX_LOGO_BYTES } from "@calcom/features/teams/lib/validateTeamLogo";
import { getPlaceholderAvatar } from "@calcom/lib/defaultAvatarImage";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Avatar } from "@calcom/ui/components/avatar";
import { Button } from "@calcom/ui/components/button";
import { ImageUploader } from "@calcom/ui/components/image-uploader";
import { useState } from "react";

const decodedSize = (dataUrl: string) => Math.floor(((dataUrl.split(",")[1] ?? "").length * 3) / 4);

type Props = {
  teamName: string;
  value: string | null;
  onChange: (logo: string | null) => void;
  canEdit: boolean;
};

export function TeamLogoField({ teamName, value, onChange, canEdit }: Props) {
  const { t } = useLocale();
  const [logoError, setLogoError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-4">
      <Avatar alt={teamName} size="lg" imageSrc={getPlaceholderAvatar(value, teamName)} />
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
                // Mirrors the server's limit so an oversized logo is caught before the request.
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
  );
}
