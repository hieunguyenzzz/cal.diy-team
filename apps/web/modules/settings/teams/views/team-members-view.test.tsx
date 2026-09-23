import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TeamMembersView from "./team-members-view";

const { getQuery, membersQuery } = vi.hoisted(() => ({ getQuery: vi.fn(), membersQuery: vi.fn() }));
vi.mock("@calcom/trpc/react", () => ({
  trpc: { viewer: { teams: { get: { useQuery: getQuery }, listMembers: { useQuery: membersQuery } } } },
}));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@calcom/features/settings/appDir/SettingsHeader", () => ({
  default: ({ title, CTA, children }: { title: string; CTA?: ReactNode; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {CTA}
      {children}
    </div>
  ),
}));
vi.mock("../components/TeamMemberRow", () => ({
  TeamMemberRow: ({
    member,
    actor,
  }: {
    member: { userId: number };
    actor: { userId: number; role: string | null; isInstanceAdmin: boolean };
  }) => <li>{`row:${member.userId} actor:${actor.userId}/${actor.role}/${actor.isInstanceAdmin}`}</li>,
}));
vi.mock("../components/AddTeamMemberDialog", () => ({
  AddTeamMemberDialog: ({ open }: { open: boolean }) => (open ? <div>add-dialog-open</div> : null),
}));

const team = { id: 10, name: "Sales", slug: "sales", bio: null, timeZone: "Europe/London", logoUrl: null };
const members = [
  { userId: 1, name: "Ann", username: "ann", email: null, avatarUrl: null, role: "OWNER", accepted: true },
  { userId: 2, name: "Bo", username: "bo", email: null, avatarUrl: null, role: "MEMBER", accepted: false },
];

describe("TeamMembersView", () => {
  beforeEach(() => {
    getQuery.mockReturnValue({ data: { ...team, role: "OWNER" }, isPending: false, error: null });
    membersQuery.mockReturnValue({ data: members, isPending: false, error: null });
  });

  it("renders a row per member, acting as the signed-in user with their team role", () => {
    render(<TeamMembersView teamId={10} currentUserId={1} isInstanceAdmin={false} />);

    expect(screen.getByText("row:1 actor:1/OWNER/false")).toBeTruthy();
    expect(screen.getByText("row:2 actor:1/OWNER/false")).toBeTruthy();
  });

  it("offers Add member to the instance admin only", () => {
    const { unmount } = render(<TeamMembersView teamId={10} currentUserId={1} isInstanceAdmin={false} />);
    expect(screen.queryByText("add_team_member")).toBeNull();
    unmount();

    getQuery.mockReturnValue({ data: { ...team, role: null }, isPending: false, error: null });
    render(<TeamMembersView teamId={10} currentUserId={9} isInstanceAdmin />);
    fireEvent.click(screen.getByText("add_team_member"));
    expect(screen.getByText("add-dialog-open")).toBeTruthy();
  });

  it.each([
    ["FORBIDDEN", "dont_have_access_this_page"],
    ["NOT_FOUND", "team_not_found"],
  ])("shows a %s state instead of the list", (code, message) => {
    getQuery.mockReturnValue({ data: undefined, isPending: false, error: { data: { code }, message: "x" } });
    membersQuery.mockReturnValue({
      data: undefined,
      isPending: false,
      error: { data: { code }, message: "x" },
    });

    render(<TeamMembersView teamId={10} currentUserId={1} isInstanceAdmin={false} />);

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByText(/^row:/)).toBeNull();
  });

  it("only asks for members once the team is known to be accessible", () => {
    getQuery.mockReturnValue({ data: undefined, isPending: true, error: null });

    render(<TeamMembersView teamId={10} currentUserId={1} isInstanceAdmin={false} />);

    expect(membersQuery).toHaveBeenLastCalledWith(
      { teamId: 10 },
      expect.objectContaining({ enabled: false })
    );
  });
});
