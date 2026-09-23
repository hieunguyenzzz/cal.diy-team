import type { CreateEventTypeFormValues } from "@calcom/atoms/hooks/event-types/private/useCreateEventTypeForm";
import CreateEventTypeForm from "@calcom/features/eventtypes/components/CreateEventTypeForm";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { SchedulingType } from "@calcom/prisma/enums";
import { Label } from "@calcom/ui/components/form";
import { RadioAreaGroup as RadioArea } from "@calcom/ui/components/radio";
import type { ReactNode } from "react";
import { useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Controller } from "react-hook-form";

// Managed event types need org features this fork doesn't have, so only these two are offered.
const SCHEDULING_TYPES = [
  { value: SchedulingType.COLLECTIVE, label: "collective", description: "collective_description" },
  { value: SchedulingType.ROUND_ROBIN, label: "round_robin", description: "round_robin_description" },
] as const;

type Props = {
  form: UseFormReturn<CreateEventTypeFormValues>;
  teamId: number;
  // The team profile slug, which already includes the "team/" prefix.
  pageSlug: string | null;
  urlPrefix: string;
  isPending: boolean;
  SubmitButton: (isPending: boolean) => ReactNode;
  handleSubmit: (values: CreateEventTypeFormValues) => void;
};

export function TeamEventTypeForm({
  form,
  teamId,
  pageSlug,
  urlPrefix,
  isPending,
  SubmitButton,
  handleSubmit,
}: Props) {
  const { t } = useLocale();

  // The create schema rejects a team event without a scheduling type, so start from a valid choice.
  useEffect(() => {
    form.setValue("teamId", teamId);
    if (!form.getValues("schedulingType")) form.setValue("schedulingType", SchedulingType.COLLECTIVE);
    // The create dialog shares this form with the personal path, so leave no team fields behind.
    return () => {
      form.setValue("teamId", undefined);
      form.setValue("schedulingType", undefined);
    };
  }, [form, teamId]);

  return (
    <CreateEventTypeForm
      form={form}
      isManagedEventType={false}
      handleSubmit={handleSubmit}
      pageSlug={pageSlug ?? ""}
      isPending={isPending}
      urlPrefix={urlPrefix}
      SubmitButton={SubmitButton}
      extraFields={
        <div>
          <Label id="team-event-scheduling-type">{t("scheduling_type")}</Label>
          <Controller
            control={form.control}
            name="schedulingType"
            render={({ field: { value, onChange } }) => (
              <RadioArea.Group
                aria-labelledby="team-event-scheduling-type"
                className="flex flex-col gap-2"
                value={value ?? SchedulingType.COLLECTIVE}
                onValueChange={onChange}>
                {SCHEDULING_TYPES.map((type) => (
                  <RadioArea.Item key={type.value} value={type.value} className="w-full text-sm">
                    <strong className="mb-1 block">{t(type.label)}</strong>
                    <p>{t(type.description)}</p>
                  </RadioArea.Item>
                ))}
              </RadioArea.Group>
            )}
          />
        </div>
      }
    />
  );
}
