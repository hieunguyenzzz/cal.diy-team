import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSubmitPersonalOnboarding } from "../useSubmitPersonalOnboarding";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

vi.mock("@calcom/lib/webstorage", () => ({
  sessionStorage: { getItem: vi.fn(() => null) },
}));

vi.mock("@calcom/ui/components/toast", () => ({
  showToast: vi.fn(),
}));

vi.mock("@calcom/web/modules/shell/hooks/useWelcomeToCalcomModal", () => ({
  setShowWelcomeToCalcomModalFlag: vi.fn(),
}));

const mockResetOnboarding = vi.fn();
vi.mock("../../store/onboarding-store", () => ({
  useOnboardingStore: () => ({ resetOnboarding: mockResetOnboarding }),
}));

type MutationOptions = { onSuccess: () => Promise<void> };
let updateProfileOptions: MutationOptions | undefined;

vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({ viewer: { me: { get: { refetch: vi.fn() } } } }),
    viewer: {
      eventTypes: { list: { useQuery: () => ({ data: [{ id: 1 }] }) } },
      eventTypesHeavy: { create: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
      me: {
        updateProfile: {
          useMutation: (options: MutationOptions) => {
            updateProfileOptions = options;
            return { mutate: vi.fn(), isPending: false };
          },
        },
      },
    },
  },
}));

describe("useSubmitPersonalOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateProfileOptions = undefined;
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), removeItem: vi.fn() });
  });

  it("clears the persisted onboarding store once onboarding completes", async () => {
    useSubmitPersonalOnboarding();

    await updateProfileOptions?.onSuccess();

    expect(mockResetOnboarding).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/event-types?welcomeToCalcomModal=true");
  });

  it("does not clear the onboarding store before onboarding completes", () => {
    useSubmitPersonalOnboarding();

    expect(mockResetOnboarding).not.toHaveBeenCalled();
  });
});
