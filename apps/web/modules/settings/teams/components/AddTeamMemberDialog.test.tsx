import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddTeamMemberDialog } from "./AddTeamMemberDialog";

const { mutate, invalidate, showToast, mutationOptions } = vi.hoisted(() => ({
  mutate: vi.fn(),
  invalidate: vi.fn(),
  showToast: vi.fn(),
  mutationOptions: {} as {
    onSuccess?: () => Promise<void>;
    onError?: (err: { message: string; data?: { code?: string } }) => void;
  },
}));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({ viewer: { teams: { listMembers: { invalidate } } } }),
    viewer: {
      teams: {
        addMember: {
          useMutation: (options: typeof mutationOptions) => {
            Object.assign(mutationOptions, options);
            return { mutate, isPending: false };
          },
        },
      },
    },
  },
}));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@calcom/ui/components/toast", () => ({ showToast }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
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
vi.mock("@calcom/ui/components/form", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/ui/components/form")>()),
  Select: ({
    inputId,
    options,
    value,
    onChange,
  }: {
    inputId: string;
    options: { value: string; label: string }[];
    value: { value: string };
    onChange: (option: { value: string }) => void;
  }) => (
    <select id={inputId} value={value.value} onChange={(e) => onChange({ value: e.target.value })}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const onOpenChange = vi.fn();
const renderDialog = (open = true) =>
  render(<AddTeamMemberDialog teamId={10} open={open} onOpenChange={onOpenChange} />);
const email = () => screen.getByLabelText("email_address") as HTMLInputElement;

describe("AddTeamMemberDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds a user by email with the chosen role", async () => {
    renderDialog();

    fireEvent.change(email(), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("role"), { target: { value: "ADMIN" } });
    fireEvent.click(screen.getByText("add"));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({ teamId: 10, email: "new@example.com", role: "ADMIN" })
    );
  });

  it("defaults the role to MEMBER and offers OWNER", () => {
    renderDialog();

    const select = screen.getByLabelText("role") as HTMLSelectElement;
    expect(select.value).toBe("MEMBER");
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["MEMBER", "ADMIN", "OWNER"]);
  });

  it("refreshes the members and closes on success", async () => {
    renderDialog();

    await mutationOptions.onSuccess?.();

    expect(invalidate).toHaveBeenCalledWith({ teamId: 10 });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("links to user creation when no user has the email", async () => {
    renderDialog();

    mutationOptions.onError?.({
      message: "No user has the email x@example.com. Create the user first.",
      data: { code: "NOT_FOUND" },
    });

    expect((await screen.findByRole("alert")).textContent).toContain("No user has the email x@example.com");
    expect(screen.getByText("add_new_user").closest("a")?.getAttribute("href")).toBe(
      "/settings/admin/users/add"
    );
  });

  it("shows other errors, such as a locked user, without the link", async () => {
    renderDialog();

    mutationOptions.onError?.({ message: "The user x@example.com is locked", data: { code: "BAD_REQUEST" } });

    expect((await screen.findByRole("alert")).textContent).toBe("The user x@example.com is locked");
    expect(screen.queryByText("add_new_user")).toBeNull();
  });

  it("starts clean when reopened after cancelling", async () => {
    const { rerender } = renderDialog();
    fireEvent.change(email(), { target: { value: "new@example.com" } });
    mutationOptions.onError?.({ message: "Nope", data: { code: "BAD_REQUEST" } });
    await screen.findByRole("alert");

    fireEvent.click(screen.getByText("cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(<AddTeamMemberDialog teamId={10} open={false} onOpenChange={onOpenChange} />);
    rerender(<AddTeamMemberDialog teamId={10} open onOpenChange={onOpenChange} />);

    expect(email().value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
