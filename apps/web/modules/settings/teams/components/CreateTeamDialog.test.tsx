import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateTeamDialog } from "./CreateTeamDialog";

const { mutate, invalidate, push, mutationOptions } = vi.hoisted(() => ({
  mutate: vi.fn(),
  invalidate: vi.fn(),
  push: vi.fn(),
  mutationOptions: {} as {
    onSuccess?: (team: { id: number }) => Promise<void>;
    onError?: (err: { message: string }) => void;
  },
}));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({ viewer: { teams: { list: { invalidate } } } }),
    viewer: {
      teams: {
        create: {
          useMutation: (options: typeof mutationOptions) => {
            Object.assign(mutationOptions, options);
            return { mutate, isPending: false };
          },
        },
      },
    },
  },
}));
vi.mock("@calcom/trpc/react/hooks/useMeQuery", () => ({
  default: () => ({ data: { timeZone: "Asia/Dubai" } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
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
vi.mock("@calcom/web/modules/timezone/components/TimezoneSelect", () => ({
  TimezoneSelect: ({ value, onChange }: { value: string; onChange: (option: { value: string }) => void }) => (
    <input aria-label="timezone" value={value} onChange={(e) => onChange({ value: e.target.value })} />
  ),
}));

const renderDialog = () => render(<CreateTeamDialog open onOpenChange={vi.fn()} />);
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe("CreateTeamDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fills the slug from the name until the slug is edited by hand", () => {
    renderDialog();

    fireEvent.change(field("team_name"), { target: { value: "Customer Success" } });
    expect(field("team_url").value).toBe("customer-success");

    fireEvent.change(field("team_url"), { target: { value: "cs" } });
    fireEvent.change(field("team_name"), { target: { value: "Customer Success EU" } });
    expect(field("team_url").value).toBe("cs");
  });

  it("defaults the time zone to the admin's and submits the form", async () => {
    renderDialog();

    expect(field("timezone").value).toBe("Asia/Dubai");
    fireEvent.change(field("team_name"), { target: { value: "Sales" } });
    fireEvent.change(field("bio"), { target: { value: "We sell" } });
    fireEvent.click(screen.getByText("create"));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        name: "Sales",
        slug: "sales",
        timeZone: "Asia/Dubai",
        bio: "We sell",
      })
    );
  });

  it("leaves an empty bio out of the request", async () => {
    renderDialog();

    fireEvent.change(field("team_name"), { target: { value: "Sales" } });
    fireEvent.click(screen.getByText("create"));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0]).not.toHaveProperty("bio");
  });

  it("refreshes the list and opens the new team's profile on success", async () => {
    renderDialog();

    await mutationOptions.onSuccess?.({ id: 42 });

    expect(invalidate).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/settings/teams/42/profile");
  });

  it("shows the server's message when creation fails", async () => {
    renderDialog();

    mutationOptions.onError?.({ message: 'The slug "sales" is already taken by another team' });

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      'The slug "sales" is already taken by another team'
    );
  });
});
