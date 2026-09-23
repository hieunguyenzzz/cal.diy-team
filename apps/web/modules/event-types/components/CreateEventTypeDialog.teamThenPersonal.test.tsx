import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateEventTypeDialog } from "./CreateEventTypeDialog";

// Uses the real form hook and the real TeamEventTypeForm: the bug was state shared between the two paths.
const { query, mutate } = vi.hoisted(() => ({
  query: { teamId: undefined as number | undefined, eventPage: "ann" },
  mutate: vi.fn(),
}));
vi.mock("@calcom/lib/hooks/useTypedQuery", () => ({ useTypedQuery: () => ({ data: query }) }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@calcom/ui/components/toast", () => ({ showToast: vi.fn() }));
vi.mock("@calcom/web/modules/event-types/hooks/useCreateEventType", async () => {
  const { useCreateEventTypeForm } = await import(
    "@calcom/atoms/hooks/event-types/private/useCreateEventTypeForm"
  );
  return {
    useCreateEventType: () => {
      const { form, isManagedEventType } = useCreateEventTypeForm();
      return { form, createMutation: { isPending: false, mutate }, isManagedEventType };
    },
  };
});
vi.mock("@calcom/features/components/controlled-dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@calcom/ui/components/dialog", () => ({
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogClose: () => null,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// The shared fields form, used by both paths, reduced to "submit the current values".
vi.mock("@calcom/features/eventtypes/components/CreateEventTypeForm", () => ({
  default: ({
    form,
    handleSubmit,
    extraFields,
  }: {
    form: { getValues: () => Record<string, unknown> };
    handleSubmit: (values: Record<string, unknown>) => void;
    extraFields?: ReactNode;
  }) => (
    <div>
      {extraFields}
      <button type="button" onClick={() => handleSubmit(form.getValues())}>
        submit
      </button>
    </div>
  ),
}));

const personal = {
  teamId: null,
  label: "Ann",
  image: "",
  membershipRole: null,
  slug: "ann",
  permissions: { canCreateEventType: true },
};
const team = {
  teamId: 10,
  label: "Sales",
  image: "",
  membershipRole: "MEMBER" as const,
  slug: "team/sales",
  permissions: { canCreateEventType: true },
};

describe("CreateEventTypeDialog, team then personal", () => {
  beforeEach(() => {
    mutate.mockClear();
  });

  it("creates a personal event type after the team form was opened and closed", () => {
    query.teamId = 10;
    query.eventPage = "team/sales";
    const { rerender } = render(<CreateEventTypeDialog profileOptions={[personal, team]} />);
    fireEvent.click(screen.getByText("submit"));
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ teamId: 10, schedulingType: "COLLECTIVE" })
    );

    query.teamId = undefined;
    query.eventPage = "ann";
    rerender(<CreateEventTypeDialog profileOptions={[personal, team]} />);
    fireEvent.click(screen.getByText("submit"));

    const personalValues = mutate.mock.lastCall?.[0];
    expect(personalValues).not.toHaveProperty("teamId");
    expect(personalValues).not.toHaveProperty("schedulingType");
  });
});
