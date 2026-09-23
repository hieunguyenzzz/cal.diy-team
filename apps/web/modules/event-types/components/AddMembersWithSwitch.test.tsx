import type { FormValues, Host, TeamMember } from "@calcom/features/eventtypes/lib/types";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { AddMembersWithSwitch } from "./AddMembersWithSwitch";

// jsdom has no Element.animate, which auto-animate needs.
vi.mock("@formkit/auto-animate/react", () => ({ useAutoAnimate: () => [null] }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
// react-select is impractical in jsdom; this stand-in keeps the contract: options in, selected options out.
vi.mock("@calcom/features/eventtypes/components/CheckedTeamSelect", () => ({
  default: ({
    options,
    value,
    onChange,
  }: {
    options: { value: string; label: string; defaultScheduleId?: number | null }[];
    value: { value: string }[];
    onChange: (selected: { value: string; defaultScheduleId?: number | null }[]) => void;
  }) => (
    <div>
      <p>{`selected:${value.map((option) => option.value).join(",")}`}</p>
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange([...value, option])}>
          {`add ${option.label}`}
        </button>
      ))}
    </div>
  ),
}));

const members: TeamMember[] = [
  { value: "1", label: "Ann", avatar: "", email: "ann@example.com", defaultScheduleId: 11 },
  { value: "2", label: "Bo", avatar: "", email: "bo@example.com", defaultScheduleId: null },
];

function Harness({
  initialAssignAll = false,
  automaticAddAllEnabled = true,
  value = [],
  onChange = vi.fn(),
  onActive = vi.fn(),
}: {
  initialAssignAll?: boolean;
  automaticAddAllEnabled?: boolean;
  value?: Host[];
  onChange?: (hosts: Host[]) => void;
  onActive?: () => void;
}) {
  const form = useForm<FormValues>({
    defaultValues: { hosts: value, assignAllTeamMembers: initialAssignAll },
  });
  const [assignAll, setAssignAll] = useState(initialAssignAll);
  return (
    <FormProvider {...form}>
      <AddMembersWithSwitch
        teamMembers={members}
        value={value}
        onChange={onChange}
        assignAllTeamMembers={assignAll}
        setAssignAllTeamMembers={setAssignAll}
        automaticAddAllEnabled={automaticAddAllEnabled}
        onActive={onActive}
        isFixed={false}
      />
    </FormProvider>
  );
}

const wrap = (children: ReactNode) => <div>{children}</div>;

describe("AddMembersWithSwitch", () => {
  it("offers assign-all and the host select when assign-all is off", () => {
    render(wrap(<Harness />));

    expect(screen.getByText("automatically_add_all_team_members")).toBeTruthy();
    expect(screen.getByText("add Ann")).toBeTruthy();
  });

  it("hides the assign-all toggle where it doesn't apply", () => {
    render(wrap(<Harness automaticAddAllEnabled={false} />));

    expect(screen.queryByText("automatically_add_all_team_members")).toBeNull();
    expect(screen.getByText("add Ann")).toBeTruthy();
  });

  it("hides the host select once all team members are assigned", () => {
    render(wrap(<Harness initialAssignAll />));

    expect(screen.getByText("automatically_add_all_team_members")).toBeTruthy();
    expect(screen.queryByText("add Ann")).toBeNull();
  });

  it("turning assign-all on runs onActive and hides the select", () => {
    const onActive = vi.fn();
    render(wrap(<Harness onActive={onActive} />));

    fireEvent.click(screen.getByRole("switch"));

    expect(onActive).toHaveBeenCalled();
    expect(screen.queryByText("add Ann")).toBeNull();
  });

  it("maps a picked member to a host with their default schedule and neutral priority and weight", () => {
    const onChange = vi.fn();
    render(wrap(<Harness onChange={onChange} />));

    fireEvent.click(screen.getByText("add Ann"));

    expect(onChange).toHaveBeenCalledWith([
      { isFixed: false, userId: 1, priority: 2, weight: 100, scheduleId: 11, groupId: null },
    ]);
  });
});
