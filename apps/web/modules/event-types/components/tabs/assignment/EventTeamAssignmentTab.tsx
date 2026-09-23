import { checkForEmptyAssignment } from "@calcom/features/eventtypes/lib/checkForEmptyAssignment";
import { DEFAULT_HOST_PRIORITY, DEFAULT_HOST_WEIGHT } from "@calcom/features/eventtypes/lib/hostDefaults";
import { hasOnlyZeroWeightRoundRobinHosts } from "@calcom/features/eventtypes/lib/roundRobinWeights";
import type {
  EventTypeSetupProps,
  FormValues,
  Host,
  TeamMember,
} from "@calcom/features/eventtypes/lib/types";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { SchedulingType } from "@calcom/prisma/enums";
import { Alert } from "@calcom/ui/components/alert";
import { Label, Select, SettingsToggle } from "@calcom/ui/components/form";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { AddMembersWithSwitch, mapUserToValue } from "../../AddMembersWithSwitch";

// Restored from before the Cal.diy trim and cut to collective and round-robin hosts for standalone teams:
// no managed/children event types, host groups, weights, segments, distribution methods or org options.

type MemberSetter = Dispatch<SetStateAction<boolean>>;

const toHosts = (teamMembers: TeamMember[], currentHosts: Host[], isFixed: boolean): Host[] =>
  teamMembers.map((member) => {
    const userId = Number.parseInt(member.value, 10);
    const existing = currentHosts.find((host) => host.userId === userId);
    return {
      isFixed,
      userId,
      priority: existing?.priority ?? DEFAULT_HOST_PRIORITY,
      weight: existing?.weight ?? DEFAULT_HOST_WEIGHT,
      // Keep a host's chosen schedule if they were already added.
      scheduleId: existing?.scheduleId || member.defaultScheduleId,
      groupId: null,
    };
  });

const SectionHeader = ({ title, description }: { title: string; description: string }) => (
  <div className="rounded-t-md border border-subtle p-6 pb-5">
    <Label className="mb-1 font-semibold text-sm">{title}</Label>
    <p className="max-w-full wrap-break-word text-sm text-subtle leading-tight">{description}</p>
  </div>
);

const FixedHosts = ({
  teamMembers,
  value,
  onChange,
  assignAllTeamMembers,
  setAssignAllTeamMembers,
  isRoundRobinEvent,
}: {
  teamMembers: TeamMember[];
  value: Host[];
  onChange: (hosts: Host[]) => void;
  assignAllTeamMembers: boolean;
  setAssignAllTeamMembers: MemberSetter;
  isRoundRobinEvent: boolean;
}) => {
  const { t } = useLocale();
  const { getValues, setValue } = useFormContext<FormValues>();
  const [showFixedHosts, setShowFixedHosts] = useState(
    isRoundRobinEvent && getValues("hosts").some((host) => host.isFixed)
  );

  const members = (
    <AddMembersWithSwitch
      data-testid="fixed-hosts-select"
      placeholder={t("add_a_member")}
      teamMembers={teamMembers}
      value={value}
      onChange={onChange}
      assignAllTeamMembers={assignAllTeamMembers}
      setAssignAllTeamMembers={setAssignAllTeamMembers}
      // In round robin, "all team members" means all of them rotate, so it lives with the RR hosts.
      automaticAddAllEnabled={!isRoundRobinEvent}
      isFixed={true}
      onActive={() =>
        setValue("hosts", toHosts(teamMembers, getValues("hosts"), true), { shouldDirty: true })
      }
    />
  );

  if (!isRoundRobinEvent) {
    return (
      <div className="mt-5 rounded-lg">
        <SectionHeader title={t("fixed_hosts")} description={t("fixed_hosts_description")} />
        <div className="rounded-b-md border border-subtle border-t-0 px-6">{members}</div>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-lg" data-testid="fixed-hosts">
      <SettingsToggle
        data-testid="fixed-hosts-switch"
        toggleSwitchAtTheEnd={true}
        title={t("fixed_hosts")}
        description={t("fixed_hosts_description")}
        checked={showFixedHosts && !assignAllTeamMembers}
        hideSwitch={assignAllTeamMembers}
        labelClassName="text-sm"
        descriptionClassName="text-sm text-subtle"
        onCheckedChange={(checked) => {
          if (!checked)
            setValue(
              "hosts",
              getValues("hosts").filter((host) => !host.isFixed),
              { shouldDirty: true }
            );
          setShowFixedHosts(checked);
        }}
        childrenClassName="lg:ml-0">
        <div className="flex flex-col gap-6 rounded-br-md rounded-bl-md border border-subtle border-t-0 px-6">
          {members}
        </div>
      </SettingsToggle>
    </div>
  );
};

const RoundRobinHosts = ({
  teamMembers,
  value,
  onChange,
  assignAllTeamMembers,
  setAssignAllTeamMembers,
}: {
  teamMembers: TeamMember[];
  value: Host[];
  onChange: (hosts: Host[]) => void;
  assignAllTeamMembers: boolean;
  setAssignAllTeamMembers: MemberSetter;
}) => {
  const { t } = useLocale();
  const { control, getValues, setValue } = useFormContext<FormValues>();
  const isRRWeightsEnabled = useWatch({ control, name: "isRRWeightsEnabled" });
  // The form's resolver blocks the save in this state; this explains why.
  const allWeightsZero = hasOnlyZeroWeightRoundRobinHosts({
    isRRWeightsEnabled: !!isRRWeightsEnabled,
    hosts: value,
  });

  return (
    <div className="mt-5 rounded-lg" data-testid="rr-hosts">
      <SectionHeader title={t("round_robin_hosts")} description={t("round_robin_hosts_description")} />
      <div className="rounded-b-md border border-subtle border-t-0 px-6">
        <div className="pt-6">
          <Controller<FormValues>
            name="isRRWeightsEnabled"
            render={({ field: { value, onChange } }) => (
              <SettingsToggle
                data-testid="rr-weights-switch"
                title={t("enable_weights")}
                description={t("rr_weights_description")}
                checked={!!value}
                onCheckedChange={onChange}
              />
            )}
          />
        </div>
        {allWeightsZero && (
          <Alert className="mt-4" severity="error" title={t("rr_weights_need_one_above_zero")} />
        )}
        <AddMembersWithSwitch
          isRRWeightsEnabled={!!isRRWeightsEnabled}
          data-testid="rr-hosts-select"
          placeholder={t("add_a_member")}
          teamMembers={teamMembers}
          value={value}
          onChange={onChange}
          assignAllTeamMembers={assignAllTeamMembers}
          setAssignAllTeamMembers={setAssignAllTeamMembers}
          automaticAddAllEnabled={true}
          isFixed={false}
          onActive={() =>
            setValue("hosts", toHosts(teamMembers, getValues("hosts"), false), { shouldDirty: true })
          }
        />
      </div>
    </div>
  );
};

const Hosts = ({
  teamMembers,
  assignAllTeamMembers,
  setAssignAllTeamMembers,
}: {
  teamMembers: TeamMember[];
  assignAllTeamMembers: boolean;
  setAssignAllTeamMembers: MemberSetter;
}) => {
  const {
    control,
    setValue,
    getValues,
    formState: { submitCount },
  } = useFormContext<FormValues>();
  const schedulingType = useWatch({ control, name: "schedulingType" });
  const initialValue = useRef<{
    hosts: FormValues["hosts"];
    schedulingType: SchedulingType | null;
    submitCount: number;
  } | null>(null);

  // Fixed/RR mean different things per scheduling type, so switching type starts the host list afresh;
  // switching back to the saved type restores the saved hosts.
  useEffect(() => {
    if (!initialValue.current || initialValue.current.submitCount !== submitCount) {
      initialValue.current = { hosts: getValues("hosts"), schedulingType, submitCount };
      return;
    }
    setValue(
      "hosts",
      initialValue.current.schedulingType === schedulingType ? initialValue.current.hosts : [],
      { shouldDirty: true }
    );
  }, [schedulingType, setValue, getValues, submitCount]);

  // Hosts are rebuilt from select options, so carry over an existing host's chosen schedule.
  const keepExistingDetails = (changedHosts: Host[]) => {
    const existingHosts = getValues("hosts");
    return changedHosts.map((host) => {
      const existing = existingHosts.find((current) => current.userId === host.userId);
      return existing ? { ...host, scheduleId: existing.scheduleId } : host;
    });
  };

  return (
    <Controller<FormValues>
      name="hosts"
      render={({ field: { onChange, value } }) => {
        if (schedulingType === SchedulingType.COLLECTIVE) {
          return (
            <FixedHosts
              teamMembers={teamMembers}
              value={value}
              onChange={(changed) => onChange(keepExistingDetails(changed))}
              assignAllTeamMembers={assignAllTeamMembers}
              setAssignAllTeamMembers={setAssignAllTeamMembers}
              isRoundRobinEvent={false}
            />
          );
        }
        if (schedulingType === SchedulingType.ROUND_ROBIN) {
          return (
            <>
              <FixedHosts
                teamMembers={teamMembers}
                value={value}
                onChange={(changed) =>
                  onChange([...value.filter((host: Host) => !host.isFixed), ...keepExistingDetails(changed)])
                }
                assignAllTeamMembers={assignAllTeamMembers}
                setAssignAllTeamMembers={setAssignAllTeamMembers}
                isRoundRobinEvent={true}
              />
              <RoundRobinHosts
                teamMembers={teamMembers}
                value={value}
                onChange={(changed) =>
                  onChange([...value.filter((host: Host) => host.isFixed), ...keepExistingDetails(changed)])
                }
                assignAllTeamMembers={assignAllTeamMembers}
                setAssignAllTeamMembers={setAssignAllTeamMembers}
              />
            </>
          );
        }
        // Controller's render must return an element, so an empty fragment stands in for null.
        return <></>;
      }}
    />
  );
};

export type EventTeamAssignmentTabProps = Pick<EventTypeSetupProps, "teamMembers" | "team">;

export const EventTeamAssignmentTab = ({ team, teamMembers }: EventTeamAssignmentTabProps) => {
  const { t } = useLocale();
  const { control, getValues, setValue } = useFormContext<FormValues>();
  const hosts = useWatch({ control, name: "hosts" });
  const [assignAllTeamMembers, setAssignAllTeamMembers] = useState<boolean>(
    getValues("assignAllTeamMembers") ?? false
  );

  const schedulingTypeOptions = [
    { value: SchedulingType.COLLECTIVE, label: t("collective") },
    { value: SchedulingType.ROUND_ROBIN, label: t("round_robin") },
  ];
  // getEventTypeById only returns accepted members for a standalone team.
  const teamMemberOptions = teamMembers.map((member) => mapUserToValue(member, t("pending")));

  const handleSchedulingTypeChange = useCallback(
    (schedulingType: SchedulingType | undefined, onChange: (value: SchedulingType) => void) => {
      if (!schedulingType) return;
      onChange(schedulingType);
      setValue("assignAllTeamMembers", false, { shouldDirty: true });
      setAssignAllTeamMembers(false);
      // Weights only apply to round-robin hosts; a collective event keeping them on is misleading.
      if (schedulingType === SchedulingType.COLLECTIVE) {
        setValue("isRRWeightsEnabled", false, { shouldDirty: true });
      }
    },
    [setValue]
  );

  if (!team) return null;

  return (
    <div>
      <div className="flex flex-col rounded-md border-subtle">
        <SectionHeader title={t("assignment")} description={t("assignment_description")} />
        <div className="rounded-b-md border border-subtle border-t-0 p-6">
          <Label>{t("scheduling_type")}</Label>
          <Controller<FormValues>
            name="schedulingType"
            render={({ field: { value, onChange } }) => (
              <Select
                options={schedulingTypeOptions}
                value={schedulingTypeOptions.find((option) => option.value === value)}
                className="w-full"
                onChange={(option) => handleSchedulingTypeChange(option?.value, onChange)}
              />
            )}
          />
        </div>
      </div>
      {/* The editor's leave-without-hosts dialog relies on router events the App Router doesn't emit, so warn here. */}
      {checkForEmptyAssignment({
        assignedUsers: [],
        hosts: hosts ?? [],
        isManagedEventType: false,
        assignAllTeamMembers,
      }) && <Alert className="mt-5" severity="warning" title={t("no_availability_shown_to_bookers")} />}
      <Hosts
        teamMembers={teamMemberOptions}
        assignAllTeamMembers={assignAllTeamMembers}
        setAssignAllTeamMembers={setAssignAllTeamMembers}
      />
    </div>
  );
};
