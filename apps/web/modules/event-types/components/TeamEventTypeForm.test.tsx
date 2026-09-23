import type { CreateEventTypeFormValues } from "@calcom/atoms/hooks/event-types/private/useCreateEventTypeForm";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { TeamEventTypeForm } from "./TeamEventTypeForm";

const { submitted } = vi.hoisted(() => ({ submitted: vi.fn() }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
// The shared personal form is exercised elsewhere; here it only needs to show the slot and submit values.
vi.mock("@calcom/features/eventtypes/components/CreateEventTypeForm", () => ({
  default: ({
    form,
    pageSlug,
    extraFields,
    handleSubmit,
  }: {
    form: { getValues: () => Record<string, unknown> };
    pageSlug: string;
    extraFields: ReactNode;
    handleSubmit: (values: Record<string, unknown>) => void;
  }) => (
    <div>
      <p>{`page:${pageSlug}`}</p>
      {extraFields}
      <button type="button" onClick={() => handleSubmit(form.getValues())}>
        submit
      </button>
    </div>
  ),
}));

const { formRef } = vi.hoisted(() => ({
  formRef: { current: null as null | { getValues: () => Record<string, unknown> } },
}));

function Harness({ showTeamForm = true }: { showTeamForm?: boolean }) {
  const form = useForm<CreateEventTypeFormValues>({
    defaultValues: { title: "Intro", slug: "intro", length: 30 },
  });
  formRef.current = form;
  if (!showTeamForm) return null;
  return (
    <TeamEventTypeForm
      form={form}
      teamId={10}
      pageSlug="team/sales"
      urlPrefix="https://cal.test"
      isPending={false}
      SubmitButton={() => null}
      handleSubmit={submitted}
    />
  );
}

describe("TeamEventTypeForm", () => {
  // The team profile's slug already carries the "team/" prefix, so it must be used as-is.
  it("prefixes the URL with the team page exactly once", () => {
    render(<Harness />);
    expect(screen.getByText("page:team/sales")).toBeTruthy();
  });

  it("offers collective and round robin, but not managed", () => {
    render(<Harness />);

    expect(screen.getByLabelText(/^collective/)).toBeTruthy();
    expect(screen.getByLabelText(/^round_robin/)).toBeTruthy();
    expect(screen.queryByText(/managed/i)).toBeNull();
  });

  it("submits the team id with collective by default", () => {
    render(<Harness />);

    fireEvent.click(screen.getByText("submit"));

    expect(submitted).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Intro", teamId: 10, schedulingType: "COLLECTIVE" })
    );
  });

  it("submits round robin when chosen", () => {
    render(<Harness />);

    fireEvent.click(screen.getByLabelText(/^round_robin/));
    fireEvent.click(screen.getByText("submit"));

    expect(submitted).toHaveBeenLastCalledWith(expect.objectContaining({ schedulingType: "ROUND_ROBIN" }));
  });

  it("names the scheduling type choice for assistive technology", () => {
    render(<Harness />);

    expect(screen.getByRole("radiogroup", { name: "scheduling_type" })).toBeTruthy();
  });

  // The form outlives the team form inside the create dialog, so it must not keep team fields behind.
  it("clears the team fields from the shared form when it unmounts", () => {
    const { rerender } = render(<Harness />);
    expect(formRef.current?.getValues()).toMatchObject({ teamId: 10, schedulingType: "COLLECTIVE" });

    rerender(<Harness showTeamForm={false} />);

    expect(formRef.current?.getValues().teamId).toBeUndefined();
    expect(formRef.current?.getValues().schedulingType).toBeUndefined();
  });
});
