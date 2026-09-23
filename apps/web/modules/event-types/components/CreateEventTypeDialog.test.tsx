import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateEventTypeDialog } from "./CreateEventTypeDialog";

const { query } = vi.hoisted(() => ({
  query: { teamId: undefined as number | undefined, eventPage: "ann" },
}));
vi.mock("@calcom/lib/hooks/useTypedQuery", () => ({ useTypedQuery: () => ({ data: query }) }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@calcom/ui/components/toast", () => ({ showToast: vi.fn() }));
vi.mock("@calcom/web/modules/event-types/hooks/useCreateEventType", () => ({
  useCreateEventType: () => ({
    form: {},
    createMutation: { isPending: false, mutate: vi.fn() },
    isManagedEventType: false,
  }),
}));
vi.mock("@calcom/features/components/controlled-dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@calcom/ui/components/dialog", () => ({
  DialogContent: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h2>{title}</h2>
      {children}
    </div>
  ),
  DialogClose: () => null,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@calcom/features/eventtypes/components/CreateEventTypeForm", () => ({
  default: ({ pageSlug }: { pageSlug: string }) => <p>{`personal-form:${pageSlug}`}</p>,
}));
vi.mock("./TeamEventTypeForm", () => ({
  TeamEventTypeForm: ({ teamId, pageSlug }: { teamId: number; pageSlug: string }) => (
    <p>{`team-form:${teamId}:${pageSlug}`}</p>
  ),
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
  slug: "team/sales",
  permissions: { canCreateEventType: true },
};

describe("CreateEventTypeDialog", () => {
  beforeEach(() => {
    query.teamId = undefined;
    query.eventPage = "ann";
  });

  it("shows the personal form without a team", () => {
    render(<CreateEventTypeDialog profileOptions={[personal, team]} />);

    expect(screen.getByText("add_new_event_type")).toBeTruthy();
    expect(screen.getByText("personal-form:ann")).toBeTruthy();
  });

  it("shows the team form for a team the user can create on", () => {
    query.teamId = 10;
    query.eventPage = "sales";

    render(<CreateEventTypeDialog profileOptions={[personal, team]} />);

    expect(screen.getByText("add_new_team_event_type")).toBeTruthy();
    expect(screen.getByText("team-form:10:team/sales")).toBeTruthy();
    expect(screen.queryByText(/personal-form/)).toBeNull();
  });

  it("explains instead of showing a form for a team the user cannot create on", () => {
    query.teamId = 99;

    render(<CreateEventTypeDialog profileOptions={[personal, team]} />);

    expect(screen.getByText("error_event_type_unauthorized_create")).toBeTruthy();
    expect(screen.queryByText(/-form:/)).toBeNull();
  });
});
