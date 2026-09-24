import type { CalendarEvent } from "@calcom/types/Calendar";
import type { CredentialPayload } from "@calcom/types/Credential";
import type { TFunction } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockAxios, mockCredentialUpdate } = vi.hoisted(() => ({
  mockAxios: vi.fn(),
  mockCredentialUpdate: vi.fn(),
}));

vi.mock("axios", () => ({ default: mockAxios }));

vi.mock("../../_utils/getAppKeysFromSlug", () => ({
  default: vi.fn().mockResolvedValue({ client_id: "client-id", client_secret: "client-secret" }),
}));

vi.mock("@calcom/prisma", () => ({
  default: {
    credential: {
      update: mockCredentialUpdate,
    },
  },
}));

import BuildCrmService from "./CrmService";

const zohoResponse = {
  data: {
    data: [{ id: "contact-1", email: "attendee@example.com", status: "success", details: { id: "event-1" } }],
  },
};

function buildCredential(key: Record<string, unknown>): CredentialPayload {
  return {
    id: 1,
    type: "zohocrm_crm",
    key: {
      scope: "ZohoCRM.modules.ALL",
      expires_in: 3600,
      expiryDate: Date.now() + 3600000,
      token_type: "Bearer",
      access_token: "access-token",
      accountServer: "https://accounts.zoho.eu",
      refresh_token: "refresh-token",
      ...key,
    },
    userId: 1,
    appId: "zohocrm",
    teamId: null,
    invalid: false,
    user: { email: "organizer@example.com" },
    delegationCredentialId: null,
    encryptedKey: null,
  };
}

function createMockEvent(): CalendarEvent {
  return {
    type: "test-event",
    title: "Test Meeting",
    startTime: "2024-01-20T14:00:00.000Z",
    endTime: "2024-01-20T15:00:00.000Z",
    uid: "booking-123",
    organizer: {
      email: "organizer@example.com",
      name: "Organizer",
      timeZone: "Europe/London",
      language: { translate: ((key: string) => key) as TFunction, locale: "en" },
    },
    attendees: [
      {
        email: "attendee@example.com",
        name: "Attendee",
        timeZone: "Europe/London",
        language: { translate: ((key: string) => key) as TFunction, locale: "en" },
      },
    ],
  };
}

async function callEveryEndpoint(credential: CredentialPayload) {
  mockAxios.mockResolvedValue(zohoResponse);
  const service = BuildCrmService(credential);
  const contacts = [{ id: "contact-1", email: "attendee@example.com" }];

  await service.getContacts({ emails: "attendee@example.com" });
  await service.createContacts([{ email: "attendee@example.com", name: "Attendee Person" }]);
  await service.createEvent(createMockEvent(), contacts);
  await service.updateEvent("event-1", createMockEvent());
  await service.deleteEvent("event-1", createMockEvent());

  return mockAxios.mock.calls.map(([config]) => `${config.method} ${config.url}`);
}

describe("ZohoCrmCrmService API domain", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends every CRM call to the EU API domain stored on the credential", async () => {
    const calls = await callEveryEndpoint(buildCredential({ api_domain: "https://www.zohoapis.eu" }));

    expect(calls).toEqual([
      "get https://www.zohoapis.eu/crm/v3/Contacts/search?criteria=((Email:equals:attendee@example.com))",
      "post https://www.zohoapis.eu/crm/v3/Contacts",
      "post https://www.zohoapis.eu/crm/v3/Events",
      "put https://www.zohoapis.eu/crm/v3/Events",
      "delete https://www.zohoapis.eu/crm/v3/Events?ids=event-1",
    ]);
  });

  it("falls back to the US API domain when the credential has no api_domain", async () => {
    const calls = await callEveryEndpoint(buildCredential({}));

    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call).toMatch(/^[a-z]+ https:\/\/www\.zohoapis\.com\/crm\/v3\//);
    }
  });

  it("falls back to the US API domain when api_domain is not a Zoho API domain", async () => {
    const calls = await callEveryEndpoint(buildCredential({ api_domain: "https://attacker.example.com" }));

    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call).toMatch(/^[a-z]+ https:\/\/www\.zohoapis\.com\/crm\/v3\//);
      expect(call).not.toContain("attacker");
    }
  });

  it("refreshes against the stored accounts server and keeps api_domain on the saved token", async () => {
    mockAxios.mockImplementation(async (config: { url: string }) =>
      config.url.endsWith("/oauth/v2/token")
        ? { data: { access_token: "new-access-token", expires_in: 3600, token_type: "Bearer" } }
        : zohoResponse
    );
    const service = BuildCrmService(
      buildCredential({ api_domain: "https://www.zohoapis.eu", expiryDate: Date.now() - 1000 })
    );

    await service.getContacts({ emails: "attendee@example.com" });

    expect(mockAxios.mock.calls[0][0].url).toBe("https://accounts.zoho.eu/oauth/v2/token");
    expect(mockCredentialUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          key: expect.objectContaining({
            access_token: "new-access-token",
            api_domain: "https://www.zohoapis.eu",
            accountServer: "https://accounts.zoho.eu",
          }),
        },
      })
    );
    expect(mockAxios.mock.calls[1][0].url).toMatch(/^https:\/\/www\.zohoapis\.eu\/crm\/v3\/Contacts\/search/);
  });
});
