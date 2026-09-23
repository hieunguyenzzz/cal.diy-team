import type { EventTypeSetupProps, FormValues } from "@calcom/features/eventtypes/lib/types";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { EventTeamAssignmentTab } from "./EventTeamAssignmentTab";

// jsdom has no Element.animate, which auto-animate needs.
vi.mock("@formkit/auto-animate/react", () => ({ useAutoAnimate: () => [null] }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@calcom/features/eventtypes/components/CheckedTeamSelect", () => ({
  default: ({
    options,
    value,
    onChange,
    "data-testid": testId,
  }: {
    options: { value: string; label: string }[];
    value: { value: string }[];
    onChange: (selected: { value: string }[]) => void;
    "data-testid": string;
  }) => (
    <div data-testid={testId}>
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange([...value, option])}>
          {`add ${option.label}`}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("@calcom/ui/components/form", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/ui/components/form")>()),
  Select: ({
    options,
    value,
    onChange,
  }: {
    options: { value: string; label: string }[];
    value?: { value: string };
    onChange: (option: { value: string } | null) => void;
  }) => (
    <select
      aria-label="scheduling_type"
      value={value?.value ?? ""}
      onChange={(e) => onChange(options.find((option) => option.value === e.target.value) ?? null)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const teamMembers = [
  { id: 1, name: "Ann", username: "ann", avatar: "", email: "ann@example.com", defaultScheduleId: 11 },
  { id: 2, name: "Bo", username: "bo", avatar: "", email: "bo@example.com", defaultScheduleId: 22 },
] as unknown as EventTypeSetupProps["teamMembers"];

function FormState() {
  const hosts = useWatch<FormValues, "hosts">({ name: "hosts" });
  const assignAll = useWatch<FormValues, "assignAllTeamMembers">({ name: "assignAllTeamMembers" });
  const summary = (hosts ?? []).map((host) => `${host.userId}:${host.isFixed ? "fixed" : "rr"}`).join(",");
  return <p data-testid="form-state">{`hosts=${summary} assignAll=${assignAll}`}</p>;
}

function Harness({ schedulingType }: { schedulingType: "COLLECTIVE" | "ROUND_ROBIN" }) {
  const form = useForm<FormValues>({
    defaultValues: { schedulingType, hosts: [], assignAllTeamMembers: false },
  });
  return (
    <FormProvider {...form}>
      <EventTeamAssignmentTab
        team={{ id: 64 } as unknown as EventTypeSetupProps["team"]}
        teamMembers={teamMembers}
      />
      <FormState />
    </FormProvider>
  );
}

const state = () => screen.getByTestId("form-state").textContent;

describe("EventTeamAssignmentTab", () => {
  it("offers only collective and round robin", () => {
    render(<Harness schedulingType="COLLECTIVE" />);

    const options = Array.from((screen.getByLabelText("scheduling_type") as HTMLSelectElement).options);
    expect(options.map((option) => option.value)).toEqual(["COLLECTIVE", "ROUND_ROBIN"]);
  });

  it("makes every collective host a fixed host", () => {
    render(<Harness schedulingType="COLLECTIVE" />);

    expect(screen.getByText("fixed_hosts")).toBeTruthy();
    expect(screen.queryByText("round_robin_hosts")).toBeNull();
    fireEvent.click(within(screen.getByTestId("fixed-hosts-select")).getByText("add Ann"));

    expect(state()).toBe("hosts=1:fixed assignAll=false");
  });

  it("adds round-robin hosts, with fixed hosts available behind a switch", () => {
    render(<Harness schedulingType="ROUND_ROBIN" />);

    expect(screen.getByText("round_robin_hosts")).toBeTruthy();
    expect(screen.queryByTestId("fixed-hosts-select")).toBeNull();
    fireEvent.click(within(screen.getByTestId("rr-hosts-select")).getByText("add Bo"));
    expect(state()).toBe("hosts=2:rr assignAll=false");

    fireEvent.click(screen.getByTestId("fixed-hosts-switch"));
    fireEvent.click(within(screen.getByTestId("fixed-hosts-select")).getByText("add Ann"));

    expect(state()).toBe("hosts=2:rr,1:fixed assignAll=false");
  });

  it("assigns every team member as a round-robin host", () => {
    render(<Harness schedulingType="ROUND_ROBIN" />);

    fireEvent.click(within(screen.getByTestId("rr-hosts")).getByRole("switch"));

    expect(state()).toBe("hosts=1:rr,2:rr assignAll=true");
    expect(screen.queryByTestId("rr-hosts-select")).toBeNull();
  });

  it("clears hosts when the scheduling type changes", () => {
    render(<Harness schedulingType="COLLECTIVE" />);
    fireEvent.click(within(screen.getByTestId("fixed-hosts-select")).getByText("add Ann"));

    fireEvent.change(screen.getByLabelText("scheduling_type"), { target: { value: "ROUND_ROBIN" } });

    expect(state()).toBe("hosts= assignAll=false");
  });

  it("warns that bookers see no availability until someone is assigned", () => {
    render(<Harness schedulingType="ROUND_ROBIN" />);
    expect(screen.getByText("no_availability_shown_to_bookers")).toBeTruthy();

    fireEvent.click(within(screen.getByTestId("rr-hosts-select")).getByText("add Bo"));
    expect(screen.queryByText("no_availability_shown_to_bookers")).toBeNull();
  });

  it("does not warn when all team members are assigned", () => {
    render(<Harness schedulingType="ROUND_ROBIN" />);

    fireEvent.click(within(screen.getByTestId("rr-hosts")).getByRole("switch"));

    expect(screen.queryByText("no_availability_shown_to_bookers")).toBeNull();
  });
});
