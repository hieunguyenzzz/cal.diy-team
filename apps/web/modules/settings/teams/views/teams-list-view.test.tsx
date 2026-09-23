import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TeamsListView from "./teams-list-view";

const { useQuery } = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock("@calcom/trpc/react", () => ({ trpc: { viewer: { teams: { list: { useQuery } } } } }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));
vi.mock("@calcom/features/settings/appDir/SettingsHeader", () => ({
  default: ({ title, CTA, children }: { title: string; CTA?: ReactNode; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {CTA}
      {children}
    </div>
  ),
}));
vi.mock("../components/CreateTeamDialog", () => ({
  CreateTeamDialog: ({ open }: { open: boolean }) => (open ? <div>create-dialog-open</div> : null),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const team = { id: 7, name: "Sales", slug: "sales", bio: null, timeZone: "Europe/London", logoUrl: null };

describe("TeamsListView", () => {
  beforeEach(() => {
    useQuery.mockReturnValue({ data: [], isPending: false });
  });

  it("shows an empty state that tells a non-admin how they get a team", () => {
    render(<TeamsListView isInstanceAdmin={false} />);

    expect(screen.getByText("no_teams")).toBeTruthy();
    expect(screen.getByText("teams_added_by_instance_admin")).toBeTruthy();
    expect(screen.queryByText("create_team")).toBeNull();
  });

  it("offers team creation to the instance admin, even when there are no teams", () => {
    render(<TeamsListView isInstanceAdmin />);

    expect(screen.getByText("create_team_to_get_started")).toBeTruthy();
    fireEvent.click(screen.getAllByText("create_team")[0]);
    expect(screen.getByText("create-dialog-open")).toBeTruthy();
  });

  it("lists the caller's teams with their role and a manage link only where they may manage", () => {
    useQuery.mockReturnValue({
      data: [
        { ...team, role: "OWNER", memberCount: null },
        { ...team, id: 8, name: "Ops", slug: "ops", role: "MEMBER", memberCount: null },
      ],
      isPending: false,
    });

    render(<TeamsListView isInstanceAdmin={false} />);

    expect(screen.getByText("Sales")).toBeTruthy();
    expect(screen.getByText("owner")).toBeTruthy();
    expect(screen.getByText("member")).toBeTruthy();
    const manageLinks = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(manageLinks).toEqual(["/settings/teams/7/profile"]);
  });

  it("shows member counts to the instance admin", () => {
    useQuery.mockReturnValue({ data: [{ ...team, role: null, memberCount: 3 }], isPending: false });

    render(<TeamsListView isInstanceAdmin />);

    expect(screen.getByText("number_member:3")).toBeTruthy();
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/settings/teams/7/profile",
    ]);
  });
});
