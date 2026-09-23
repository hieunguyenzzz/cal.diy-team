import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import {
  Dropdown,
  DropdownItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@calcom/ui/components/dropdown";
import type { ProfileOption } from "./CreateEventTypeDialog";

const newEventTypeHref = (profile: ProfileOption) =>
  `?dialog=new&eventPage=${profile.slug ?? ""}${profile.teamId ? `&teamId=${profile.teamId}` : ""}`;

// With only a personal profile the button opens the form directly; team members pick where to create it.
export function NewEventTypeButton({ profileOptions }: { profileOptions: ProfileOption[] }) {
  const { t } = useLocale();

  if (profileOptions.length <= 1) {
    return (
      <Button data-testid="new-event-type" href={newEventTypeHref(profileOptions[0])}>
        {t("new")}
      </Button>
    );
  }

  return (
    <Dropdown modal={false}>
      <DropdownMenuTrigger asChild>
        <Button data-testid="new-event-type" EndIcon="chevron-down">
          {t("new")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{t("create_event_on")}</DropdownMenuLabel>
        {profileOptions.map((profile) => (
          <DropdownMenuItem key={profile.teamId ?? "personal"}>
            <DropdownItem
              href={newEventTypeHref(profile)}
              data-testid={`option-${profile.teamId ?? "personal"}`}>
              {profile.label}
            </DropdownItem>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </Dropdown>
  );
}
