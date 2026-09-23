import type { FormValues } from "@calcom/features/eventtypes/lib/types";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WeightDialog } from "./HostEditDialogs";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@calcom/features/components/controlled-dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
}));
vi.mock("@calcom/ui/components/dialog", () => ({
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogClose: () => null,
}));

const options = [
  { value: "1", label: "Ann", avatar: "", groupId: null },
  { value: "2", label: "Bo", avatar: "", groupId: null },
];
const onChange = vi.fn();

function Harness() {
  const form = useForm<FormValues>({
    defaultValues: {
      isRRWeightsEnabled: true,
      hostGroups: [],
      hosts: [
        { userId: 1, isFixed: false, priority: 2, weight: 100, groupId: null },
        { userId: 2, isFixed: false, priority: 2, weight: 100, groupId: null },
      ],
    },
  });
  return (
    <FormProvider {...form}>
      <WeightDialog
        isOpenDialog
        setIsOpenDialog={vi.fn()}
        option={{ ...options[1], weight: 100 }}
        options={options}
        onChange={onChange}
      />
    </FormProvider>
  );
}

const weightOf = (userId: string) =>
  (onChange.mock.lastCall?.[0] as { value: string; weight: number }[]).find(
    (option) => option.value === userId
  )?.weight;

describe("WeightDialog", () => {
  beforeEach(() => {
    onChange.mockClear();
  });

  // The input allows 0 (min={0}); a host at 0% should get no round-robin bookings.
  it("saves a weight of 0", () => {
    render(<Harness />);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0" } });
    fireEvent.click(screen.getByText("confirm"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(weightOf("2")).toBe(0);
    expect(weightOf("1")).toBe(100);
  });

  it("saves a positive weight", () => {
    render(<Harness />);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "250" } });
    fireEvent.click(screen.getByText("confirm"));

    expect(weightOf("2")).toBe(250);
  });

  it("changes nothing when the weight is cleared", () => {
    render(<Harness />);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } });
    fireEvent.click(screen.getByText("confirm"));

    expect(onChange).not.toHaveBeenCalled();
  });
});
