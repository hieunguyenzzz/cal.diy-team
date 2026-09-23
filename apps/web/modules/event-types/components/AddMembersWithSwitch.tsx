import AssignAllTeamMembers from "@calcom/features/eventtypes/components/AssignAllTeamMembers";
import type { CheckedSelectOption } from "@calcom/features/eventtypes/components/CheckedTeamSelect";
import CheckedTeamSelect from "@calcom/features/eventtypes/components/CheckedTeamSelect";
import { DEFAULT_HOST_PRIORITY, DEFAULT_HOST_WEIGHT } from "@calcom/features/eventtypes/lib/hostDefaults";
import type { Host, TeamMember } from "@calcom/features/eventtypes/lib/types";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { Dispatch, SetStateAction } from "react";

// Restored from before the Cal.diy trim and cut down to plain host selection: no segments, platform
// wrapper or host groups. Priority is live (the host list's priority button feeds getLuckyUser's round-robin
// ordering); weights stay at their neutral default because weighting is disabled until it gets its own UI.

interface IUserToValue {
  id: number | null;
  name: string | null;
  username: string | null;
  avatar: string;
  email: string;
  defaultScheduleId: number | null;
}

const mapUserToValue = (
  { id, name, username, avatar, email, defaultScheduleId }: IUserToValue,
  pendingString: string
): TeamMember => ({
  value: `${id || ""}`,
  label: `${name || email || ""}${!username ? ` (${pendingString})` : ""}`,
  avatar,
  email,
  defaultScheduleId,
});

const sortByLabel = (a: TeamMember, b: TeamMember) => a.label.localeCompare(b.label);

const CheckedHostField = ({
  placeholder,
  options,
  isFixed,
  value,
  onChange,
  "data-testid": dataTestId,
}: {
  placeholder: string;
  options: CheckedSelectOption[];
  isFixed: boolean;
  value: Host[];
  onChange: (hosts: Host[]) => void;
  "data-testid"?: string;
}) => (
  <CheckedTeamSelect
    data-testid={dataTestId}
    isOptionDisabled={(option) => value.some((host) => host.userId.toString() === option.value)}
    onChange={(selected) =>
      onChange(
        selected.map((option) => ({
          isFixed,
          userId: Number.parseInt(option.value, 10),
          priority: option.priority ?? DEFAULT_HOST_PRIORITY,
          weight: option.weight ?? DEFAULT_HOST_WEIGHT,
          scheduleId: option.defaultScheduleId ?? null,
          groupId: null,
        }))
      )
    }
    value={value
      .filter((host) => host.isFixed === isFixed)
      .flatMap((host) => {
        const option = options.find((member) => member.value === host.userId.toString());
        return option
          ? [
              {
                ...option,
                isFixed,
                priority: host.priority ?? DEFAULT_HOST_PRIORITY,
                weight: host.weight ?? DEFAULT_HOST_WEIGHT,
              },
            ]
          : [];
      })}
    controlShouldRenderValue={false}
    options={options}
    placeholder={placeholder}
    isRRWeightsEnabled={false}
    groupId={null}
  />
);

type AddMembersWithSwitchProps = {
  teamMembers: TeamMember[];
  value: Host[];
  onChange: (hosts: Host[]) => void;
  assignAllTeamMembers: boolean;
  setAssignAllTeamMembers: Dispatch<SetStateAction<boolean>>;
  // Assign-all only applies where every member would get the same kind of host role.
  automaticAddAllEnabled: boolean;
  onActive: () => void;
  isFixed: boolean;
  placeholder?: string;
  "data-testid"?: string;
};

function AddMembersWithSwitch({
  teamMembers,
  value,
  onChange,
  assignAllTeamMembers,
  setAssignAllTeamMembers,
  automaticAddAllEnabled,
  onActive,
  isFixed,
  placeholder,
  "data-testid": dataTestId,
}: AddMembersWithSwitchProps) {
  const { t } = useLocale();

  return (
    <div className="flex flex-col gap-2 rounded-md pt-6 pb-2">
      {automaticAddAllEnabled && (
        <AssignAllTeamMembers
          assignAllTeamMembers={assignAllTeamMembers}
          setAssignAllTeamMembers={setAssignAllTeamMembers}
          onActive={onActive}
        />
      )}
      {!assignAllTeamMembers && (
        <CheckedHostField
          data-testid={dataTestId}
          value={value}
          onChange={onChange}
          isFixed={isFixed}
          options={[...teamMembers].sort(sortByLabel).map((member) => ({ ...member, groupId: null }))}
          placeholder={placeholder ?? t("add_attendees")}
        />
      )}
    </div>
  );
}

export { AddMembersWithSwitch, mapUserToValue };
