import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamMemberRow } from "./TeamMemberRow";

const { changeRole, remove, invalidateMembers, invalidateGet, invalidateList, push, showToast, options } =
  vi.hoisted(() => ({
    changeRole: vi.fn(),
    remove: vi.fn(),
    invalidateMembers: vi.fn(),
    invalidateGet: vi.fn(),
    invalidateList: vi.fn(),
    push: vi.fn(),
    showToast: vi.fn(),
    options: {} as Record<
      string,
      { onSuccess?: () => Promise<void>; onError?: (err: { message: string }) => void }
    >,
  }));
const { mutation } = vi.hoisted(() => ({
  mutation: (name: string, mutate: (input: unknown) => void) => ({
    useMutation: (opts: {
      onSuccess?: () => Promise<void>;
      onError?: (err: { message: string }) => void;
    }) => {
      options[name] = opts;
      return { mutate, isPending: false };
    },
  }),
}));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      viewer: {
        teams: {
          listMembers: { invalidate: invalidateMembers },
          get: { invalidate: invalidateGet },
          list: { invalidate: invalidateList },
        },
      },
    }),
    viewer: {
      teams: {
        changeMemberRole: mutation("changeRole", changeRole),
        removeMember: mutation("remove", remove),
      },
    },
  },
}));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@calcom/ui/components/toast", () => ({ showToast }));
vi.mock("@calcom/ui/components/form", () => ({
  Select: ({
    options: selectOptions,
    value,
    onChange,
    "aria-label": ariaLabel,
  }: {
    options: { value: string; label: string }[];
    value: { value: string };
    onChange: (option: { value: string }) => void;
    "aria-label": string;
  }) => (
    <select aria-label={ariaLabel} value={value.value} onChange={(e) => onChange({ value: e.target.value })}>
      {selectOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@calcom/features/components/controlled-dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
}));
vi.mock("@calcom/ui/components/dialog", () => ({
  ConfirmationDialogContent: ({
    title,
    confirmBtnText,
    onConfirm,
    children,
  }: {
    title: string;
    confirmBtnText: string;
    onConfirm: () => void;
    children: ReactNode;
  }) => (
    <div role="dialog" aria-label={title}>
      {children}
      <button type="button" onClick={onConfirm}>
        {`confirm:${confirmBtnText}`}
      </button>
    </div>
  ),
}));

type Role = "MEMBER" | "ADMIN" | "OWNER";
const row = (userId: number, role: Role, extra: { accepted?: boolean; email?: string | null } = {}) => ({
  userId,
  name: `User ${userId}`,
  username: `user${userId}`,
  email: extra.email === undefined ? `user${userId}@example.com` : extra.email,
  avatarUrl: null,
  role,
  accepted: extra.accepted ?? true,
});
const actor = (role: Role | null, isInstanceAdmin = false) => ({ userId: 1, role, isInstanceAdmin });
const renderRow = (member: ReturnType<typeof row>, as: ReturnType<typeof actor>) =>
  render(<TeamMemberRow teamId={10} member={member} actor={as} />);
const roleOptions = () =>
  Array.from((screen.getByLabelText("role") as HTMLSelectElement).options).map((option) => option.value);

describe("TeamMemberRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the email only when the server sent one", () => {
    renderRow(row(2, "MEMBER"), actor("ADMIN"));
    expect(screen.getByText("user2@example.com")).toBeTruthy();
  });

  it("hides the email when it is null", () => {
    renderRow(row(2, "MEMBER", { email: null }), actor("MEMBER"));
    expect(screen.queryByText("user2@example.com")).toBeNull();
    expect(screen.getByText("@user2")).toBeTruthy();
  });

  it("marks a pending member", () => {
    renderRow(row(2, "MEMBER", { accepted: false }), actor("ADMIN"));
    expect(screen.getByText("pending")).toBeTruthy();
  });

  it("gives a plain member no actions on someone else's row", () => {
    renderRow(row(2, "MEMBER"), actor("MEMBER"));
    expect(screen.queryByLabelText("role")).toBeNull();
    expect(screen.queryByText("remove")).toBeNull();
    expect(screen.queryByText("leave")).toBeNull();
    expect(screen.getByText("member")).toBeTruthy();
  });

  it("lets a plain member leave from their own row", async () => {
    renderRow(row(1, "MEMBER"), actor("MEMBER"));

    fireEvent.click(screen.getByText("leave"));
    fireEvent.click(screen.getByText("confirm:leave_team"));
    expect(remove).toHaveBeenCalledWith({ teamId: 10, userId: 1 });

    await options.remove.onSuccess?.();
    expect(invalidateList).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/settings/teams");
  });

  it("offers a team admin MEMBER and ADMIN only, and no actions on an owner", () => {
    const { unmount } = renderRow(row(2, "MEMBER"), actor("ADMIN"));
    expect(roleOptions()).toEqual(["MEMBER", "ADMIN"]);
    unmount();

    renderRow(row(3, "OWNER"), actor("ADMIN"));
    expect(screen.queryByLabelText("role")).toBeNull();
    expect(screen.queryByText("remove")).toBeNull();
  });

  it.each([
    ["an owner", actor("OWNER")],
    ["the instance admin", actor(null, true)],
  ])("lets %s grant OWNER and act on an owner row", (_label, as) => {
    renderRow(row(3, "OWNER"), as);
    expect(roleOptions()).toEqual(["MEMBER", "ADMIN", "OWNER"]);
    expect(screen.getByText("remove")).toBeTruthy();
  });

  it("changes a role and refreshes the members", async () => {
    renderRow(row(2, "MEMBER"), actor("OWNER"));

    fireEvent.change(screen.getByLabelText("role"), { target: { value: "ADMIN" } });
    expect(changeRole).toHaveBeenCalledWith({ teamId: 10, userId: 2, role: "ADMIN" });

    await options.changeRole.onSuccess?.();
    expect(invalidateMembers).toHaveBeenCalledWith({ teamId: 10 });
    expect(invalidateGet).toHaveBeenCalledWith({ teamId: 10 });
    expect(invalidateList).toHaveBeenCalled();
  });

  it("removes another member after confirmation and stays on the page", async () => {
    renderRow(row(2, "MEMBER"), actor("ADMIN"));

    fireEvent.click(screen.getByText("remove"));
    fireEvent.click(screen.getByText("confirm:remove_member"));
    expect(remove).toHaveBeenCalledWith({ teamId: 10, userId: 2 });

    await options.remove.onSuccess?.();
    expect(invalidateMembers).toHaveBeenCalledWith({ teamId: 10 });
    expect(push).not.toHaveBeenCalled();
    expect(invalidateList).toHaveBeenCalled();
  });

  it("gives the remove button an accessible name", () => {
    renderRow(row(2, "MEMBER"), actor("ADMIN"));

    expect(screen.getByRole("button", { name: "remove" })).toBeTruthy();
  });

  it("shows the server's message when an action fails, e.g. the last-owner guard", () => {
    renderRow(row(1, "OWNER"), actor("OWNER"));

    options.changeRole.onError?.({ message: "A team must keep at least one owner; this is the last owner" });

    expect(showToast).toHaveBeenCalledWith(
      "A team must keep at least one owner; this is the last owner",
      "error"
    );
  });
});
