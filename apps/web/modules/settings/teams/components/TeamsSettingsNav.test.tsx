import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamsSettingsNav } from "./TeamsSettingsNav";

const { useQuery } = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock("@calcom/trpc/react", () => ({ trpc: { viewer: { teams: { list: { useQuery } } } } }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@calcom/ui/components/navigation", () => ({
  VerticalTabItem: ({ name, href }: { name: string; href: string }) => <a href={href}>{name}</a>,
}));
vi.mock("@calcom/ui/components/icon", () => ({ Icon: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const team = (id: number, name: string, role: string | null) => ({
  id,
  name,
  slug: name.toLowerCase(),
  bio: null,
  timeZone: "Europe/London",
  logoUrl: null,
  role,
  memberCount: role ? null : 3,
});

const hrefs = () => screen.getAllByRole("link").map((link) => link.getAttribute("href"));

describe("TeamsSettingsNav", () => {
  beforeEach(() => {
    useQuery.mockReturnValue({ data: [] });
  });

  it("always links to the teams page", () => {
    render(<TeamsSettingsNav />);

    expect(hrefs()).toEqual(["/settings/teams"]);
  });

  it("links to profile and members only for teams the caller admins or owns", () => {
    useQuery.mockReturnValue({
      data: [team(1, "Sales", "OWNER"), team(2, "Support", "ADMIN"), team(3, "Ops", "MEMBER")],
    });

    render(<TeamsSettingsNav />);

    expect(hrefs()).toEqual([
      "/settings/teams",
      "/settings/teams/1/profile",
      "/settings/teams/1/members",
      "/settings/teams/2/profile",
      "/settings/teams/2/members",
    ]);
    expect(screen.getByText("Sales")).toBeTruthy();
    expect(screen.queryByText("Ops")).toBeNull();
  });

  it("gives the instance admin children only for teams they admin or own themselves", () => {
    useQuery.mockReturnValue({ data: [team(4, "Sales", null), team(6, "Ops", "OWNER")] });

    render(<TeamsSettingsNav />);

    expect(hrefs()).toEqual(["/settings/teams", "/settings/teams/6/profile", "/settings/teams/6/members"]);
    expect(screen.queryByText("Sales")).toBeNull();
  });

  it("labels the list link apart from the section header", () => {
    render(<TeamsSettingsNav />);

    const link = screen.getByRole("link");
    expect(link.textContent).toBe("all_teams");
    expect(link.getAttribute("href")).toBe("/settings/teams");
  });

  it("shows a team name with dots verbatim rather than as a translation key", () => {
    useQuery.mockReturnValue({ data: [team(5, "Sales.EU: North", "OWNER")] });

    render(<TeamsSettingsNav />);

    expect(screen.getByText("Sales.EU: North")).toBeTruthy();
  });
});
