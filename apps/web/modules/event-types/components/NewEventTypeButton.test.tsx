import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { NewEventTypeButton } from "./NewEventTypeButton";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
// Radix menus only render their content when opened; render it inline so the options can be asserted.
vi.mock("@calcom/ui/components/dropdown", () => ({
  Dropdown: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownItem: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const personal = {
  teamId: null,
  label: "Ann",
  image: "",
  membershipRole: null,
  slug: "ann",
  permissions: { canCreateEventType: true },
};
const team = {
  teamId: 10,
  label: "Sales",
  image: "",
  membershipRole: "MEMBER" as const,
  slug: "sales",
  permissions: { canCreateEventType: true },
};
const hrefs = () => screen.getAllByRole("link").map((link) => link.getAttribute("href"));

describe("NewEventTypeButton", () => {
  it("links straight to the personal form when there is no team", () => {
    render(<NewEventTypeButton profileOptions={[personal]} />);

    expect(hrefs()).toEqual(["?dialog=new&eventPage=ann"]);
    expect(screen.queryByText("create_event_on")).toBeNull();
  });

  it("offers each profile, with the team's id, once the user is in a team", () => {
    render(<NewEventTypeButton profileOptions={[personal, team]} />);

    expect(screen.getByText("create_event_on")).toBeTruthy();
    expect(hrefs()).toEqual(["?dialog=new&eventPage=ann", "?dialog=new&eventPage=sales&teamId=10"]);
    expect(screen.getByText("Sales")).toBeTruthy();
  });
});
