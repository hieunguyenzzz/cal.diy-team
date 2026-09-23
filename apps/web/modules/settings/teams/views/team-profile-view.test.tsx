import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TeamProfileView from "./team-profile-view";

const { getQuery, listQuery, mutate, invalidateGet, invalidateList, mutationOptions, uploader } = vi.hoisted(
  () => ({
    getQuery: vi.fn(),
    listQuery: vi.fn(),
    uploader: { next: "data:image/png;base64,AAAA" },
    mutate: vi.fn(),
    invalidateGet: vi.fn(),
    invalidateList: vi.fn(),
    mutationOptions: {} as {
      onSuccess?: (team: unknown) => Promise<void>;
      onError?: (err: { message: string }) => void;
    },
  })
);
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      viewer: { teams: { get: { invalidate: invalidateGet }, list: { invalidate: invalidateList } } },
    }),
    viewer: {
      teams: {
        get: { useQuery: getQuery },
        list: { useQuery: listQuery },
        update: {
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
vi.mock("@calcom/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/lib/constants")>()),
  WEBAPP_URL: "https://cal.test",
}));
vi.mock("@calcom/ui/components/toast", () => ({ showToast: vi.fn() }));
vi.mock("@calcom/features/settings/appDir/SettingsHeader", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@calcom/ui/components/image-uploader", () => ({
  ImageUploader: ({
    buttonMsg,
    handleAvatarChange,
  }: {
    buttonMsg: string;
    handleAvatarChange: (src: string) => void;
  }) => (
    <button type="button" onClick={() => handleAvatarChange(uploader.next)}>
      {buttonMsg}
    </button>
  ),
}));
vi.mock("@calcom/web/modules/timezone/components/TimezoneSelect", () => ({
  TimezoneSelect: ({
    inputId,
    value,
    isDisabled,
  }: {
    inputId: string;
    value: string;
    isDisabled?: boolean;
  }) => <input id={inputId} value={value} disabled={isDisabled} readOnly />,
}));
vi.mock("../components/DeleteTeamSection", () => ({
  DeleteTeamSection: ({ team }: { team: { slug: string } }) => <div>delete-section:{team.slug}</div>,
}));

const team = {
  id: 10,
  name: "Sales",
  slug: "sales",
  bio: "We sell",
  timeZone: "Europe/London",
  logoUrl: "/api/avatar/logo.png",
};

const givenTeam = (role: string | null) => {
  getQuery.mockReturnValue({ data: { ...team, role }, isPending: false, error: null });
};

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe("TeamProfileView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploader.next = "data:image/png;base64,AAAA";
  });

  it("decides editability from teams.get alone, without the teams list", () => {
    givenTeam("OWNER");

    render(<TeamProfileView teamId={10} isInstanceAdmin={false} />);

    expect(listQuery).not.toHaveBeenCalled();
    expect(field("team_name").disabled).toBe(false);
  });

  it("lets a team owner edit, and previews the public URL", () => {
    givenTeam("OWNER");

    render(<TeamProfileView teamId={10} isInstanceAdmin={false} />);

    expect(field("team_name").disabled).toBe(false);
    expect(screen.getByText("upload_logo")).toBeTruthy();
    expect(screen.getByText("remove_logo")).toBeTruthy();
    expect(screen.getByText("https://cal.test/team/sales")).toBeTruthy();
    expect(screen.getByText("update")).toBeTruthy();
    expect(screen.queryByText(/delete-section/)).toBeNull();
  });

  it("shows a plain member the profile read-only", () => {
    givenTeam("MEMBER");

    render(<TeamProfileView teamId={10} isInstanceAdmin={false} />);

    expect(screen.getByText("only_team_admins_can_edit_profile")).toBeTruthy();
    for (const label of ["team_name", "team_url", "bio", "timezone"]) {
      expect(field(label).disabled).toBe(true);
    }
    expect(screen.queryByText("upload_logo")).toBeNull();
    expect(screen.queryByText("remove_logo")).toBeNull();
    expect(screen.queryByText("update")).toBeNull();
  });

  it("lets the instance admin edit and shows the danger zone", () => {
    givenTeam(null);

    render(<TeamProfileView teamId={10} isInstanceAdmin />);

    expect(field("team_name").disabled).toBe(false);
    expect(screen.getByText("delete-section:sales")).toBeTruthy();
  });

  it.each([
    ["FORBIDDEN", "dont_have_access_this_page"],
    ["NOT_FOUND", "team_not_found"],
  ])("shows a %s state instead of the form", (code, message) => {
    getQuery.mockReturnValue({ data: undefined, isPending: false, error: { data: { code }, message: "x" } });

    render(<TeamProfileView teamId={10} isInstanceAdmin={false} />);

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByLabelText("team_name")).toBeNull();
  });

  it("sends only the changed fields", async () => {
    givenTeam("ADMIN");
    render(<TeamProfileView teamId={10} isInstanceAdmin={false} />);

    fireEvent.change(field("team_name"), { target: { value: "Sales EU" } });
    fireEvent.click(screen.getByText("update"));

    await waitFor(() => expect(mutate).toHaveBeenCalledWith({ teamId: 10, name: "Sales EU" }));
  });

  it("sends an uploaded logo as a data URL, and null when it is removed", async () => {
    givenTeam("OWNER");
    render(<TeamProfileView teamId={10} isInstanceAdmin={false} />);

    fireEvent.click(screen.getByText("upload_logo"));
    fireEvent.click(screen.getByText("update"));
    await waitFor(() =>
      expect(mutate).toHaveBeenLastCalledWith({ teamId: 10, logo: "data:image/png;base64,AAAA" })
    );

    fireEvent.click(screen.getByText("remove_logo"));
    fireEvent.click(screen.getByText("update"));
    await waitFor(() => expect(mutate).toHaveBeenLastCalledWith({ teamId: 10, logo: null }));
  });

  it("refreshes the team on success and shows server errors inline", async () => {
    givenTeam("OWNER");
    render(<TeamProfileView teamId={10} isInstanceAdmin={false} />);

    await mutationOptions.onSuccess?.(team);
    expect(invalidateGet).toHaveBeenCalledWith({ teamId: 10 });
    expect(invalidateList).toHaveBeenCalled();

    mutationOptions.onError?.({ message: 'The slug "sales" is already taken by another team' });
    expect((await screen.findByRole("alert")).textContent).toBe(
      'The slug "sales" is already taken by another team'
    );
  });

  it("rejects a logo over 2 MB without changing the current one", async () => {
    givenTeam("OWNER");
    uploader.next = `data:image/png;base64,${"A".repeat(Math.ceil((2 * 1024 * 1024 + 1) / 3) * 4)}`;
    render(<TeamProfileView teamId={10} isInstanceAdmin={false} />);

    fireEvent.click(screen.getByText("upload_logo"));

    expect(screen.getByText("team_logo_too_large")).toBeTruthy();
    expect((screen.getByText("update").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables Update again once a save succeeds", async () => {
    givenTeam("OWNER");
    render(<TeamProfileView teamId={10} isInstanceAdmin={false} />);
    const update = () => screen.getByText("update").closest("button") as HTMLButtonElement;

    fireEvent.change(field("team_name"), { target: { value: "Sales EU" } });
    expect(update().disabled).toBe(false);

    await act(async () => {
      await mutationOptions.onSuccess?.({ ...team, name: "Sales EU", role: "OWNER" });
    });

    expect(update().disabled).toBe(true);
    expect(field("team_name").value).toBe("Sales EU");
  });
});
