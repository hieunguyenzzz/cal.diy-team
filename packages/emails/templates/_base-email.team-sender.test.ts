import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn((_payload: Record<string, unknown>, cb: (err: unknown, info: unknown) => void) =>
  cb(null, {})
);
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail }) }));
vi.mock("@calcom/prisma", () => ({ prisma: {} }));
vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: class {
    checkIfFeatureIsEnabledGlobally = async () => false;
  },
}));

const FROM = "SoundBox Store <noreply@soundboxstore.com>";

const loadEmail = async (teamId?: number) => {
  const { default: BaseEmail } = await import("./_base-email");
  class TestEmail extends BaseEmail {
    calEvent = teamId === undefined ? undefined : { team: { id: teamId, name: "t", members: [] } };
    name = "TEST_EMAIL";
    protected async getNodeMailerPayload() {
      return { from: FROM, to: "someone@example.com", subject: "s" };
    }
  }
  return new TestEmail();
};

describe("BaseEmail.sendEmail team sender override", () => {
  beforeEach(() => {
    vi.resetModules();
    sendMail.mockClear();
    delete process.env.INTEGRATION_TEST_MODE;
  });

  it("sends with the default from when EMAIL_SENDER_BY_TEAM is unset", async () => {
    vi.stubEnv("EMAIL_SENDER_BY_TEAM", "");
    await (await loadEmail(3)).sendEmail();
    expect(sendMail.mock.calls[0][0].from).toBe(FROM);
  });

  it("applies the override for a mapped team", async () => {
    vi.stubEnv(
      "EMAIL_SENDER_BY_TEAM",
      '{"3":{"address":"bookings@quellworkspaces.com","name":"Quell Workspaces"}}'
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await (await loadEmail(3)).sendEmail();
    expect(sendMail.mock.calls[0][0].from).toBe("Quell Workspaces <bookings@quellworkspaces.com>");
    expect(log).toHaveBeenCalledWith("[email-sender] team=3 override applied template=TEST_EMAIL");
    log.mockRestore();
  });

  it("keeps the default from for an unmapped team and for emails without a calEvent", async () => {
    vi.stubEnv("EMAIL_SENDER_BY_TEAM", '{"3":{"name":"Quell Workspaces"}}');
    await (await loadEmail(2)).sendEmail();
    await (await loadEmail()).sendEmail();
    expect(sendMail.mock.calls[0][0].from).toBe(FROM);
    expect(sendMail.mock.calls[1][0].from).toBe(FROM);
  });
});
