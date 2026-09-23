import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteTeamSection } from "./DeleteTeamSection";

const { countQuery, mutate, invalidate, push, mutationOptions } = vi.hoisted(() => ({
  countQuery: vi.fn(),
  mutate: vi.fn(),
  invalidate: vi.fn(),
  push: vi.fn(),
  mutationOptions: {} as { onSuccess?: () => Promise<void>; onError?: (err: { message: string }) => void },
}));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({ viewer: { teams: { list: { invalidate } } } }),
    viewer: {
      teams: {
        countUpcomingBookings: { useQuery: countQuery },
        delete: {
          useMutation: (options: typeof mutationOptions) => {
            Object.assign(mutationOptions, options);
            return { mutate, isPending: false };
          },
        },
      },
    },
  },
}));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@calcom/ui/components/toast", () => ({ showToast: vi.fn() }));
vi.mock("@calcom/features/components/controlled-dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
}));
vi.mock("@calcom/ui/components/dialog", () => ({
  DialogContent: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h2>{title}</h2>
      {children}
    </div>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const team = { id: 10, name: "Sales", slug: "sales" };
const confirmButton = () => screen.getByTestId("confirm-delete-team") as HTMLButtonElement;

describe("DeleteTeamSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countQuery.mockReturnValue({ data: 3, isPending: false });
  });

  it("only counts upcoming bookings once the dialog is open", () => {
    render(<DeleteTeamSection team={team} />);

    expect(countQuery).toHaveBeenLastCalledWith({ teamId: 10 }, expect.objectContaining({ enabled: false }));
    fireEvent.click(screen.getByText("delete_team"));
    expect(countQuery).toHaveBeenLastCalledWith({ teamId: 10 }, expect.objectContaining({ enabled: true }));
  });

  it("warns how many upcoming bookings the team has", () => {
    render(<DeleteTeamSection team={team} />);
    fireEvent.click(screen.getByText("delete_team"));

    expect(screen.getByText('team_upcoming_bookings_warning:{"count":3}')).toBeTruthy();
  });

  it("keeps delete disabled until the slug is typed exactly", () => {
    render(<DeleteTeamSection team={team} />);
    fireEvent.click(screen.getByText("delete_team"));
    const input = screen.getByLabelText('type_team_slug_to_confirm:{"slug":"sales"}');

    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(input, { target: { value: "Sales" } });
    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(input, { target: { value: "sales" } });
    expect(confirmButton().disabled).toBe(false);

    fireEvent.click(confirmButton());
    expect(mutate).toHaveBeenCalledWith({ teamId: 10 });
  });

  it("keeps delete disabled while the booking count is still loading", () => {
    countQuery.mockReturnValue({ data: undefined, isPending: true });
    render(<DeleteTeamSection team={team} />);
    fireEvent.click(screen.getByText("delete_team"));
    fireEvent.change(screen.getByLabelText('type_team_slug_to_confirm:{"slug":"sales"}'), {
      target: { value: "sales" },
    });

    expect(confirmButton().disabled).toBe(true);
  });

  it("returns to the teams list after deleting", async () => {
    render(<DeleteTeamSection team={team} />);

    await mutationOptions.onSuccess?.();

    expect(invalidate).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/settings/teams");
  });

  it("confirms against the team name when the team has no slug", () => {
    render(<DeleteTeamSection team={{ ...team, slug: null }} />);
    fireEvent.click(screen.getByText("delete_team"));
    const input = screen.getByLabelText('type_team_slug_to_confirm:{"slug":"Sales"}');

    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(input, { target: { value: "Sales" } });
    expect(confirmButton().disabled).toBe(false);
  });

  it("clears a server error when the dialog is closed", async () => {
    render(<DeleteTeamSection team={team} />);
    fireEvent.click(screen.getByText("delete_team"));
    mutationOptions.onError?.({ message: "Could not delete" });
    expect(await screen.findByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByText("cancel"));
    fireEvent.click(screen.getByText("delete_team"));

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
