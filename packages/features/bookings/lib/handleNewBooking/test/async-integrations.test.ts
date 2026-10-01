/**
 * BOOKING_ASYNC_INTEGRATIONS (SBS-618): new plain bookings respond before the video meeting is created,
 * then create it, store references and send the confirmation emails in the background.
 */
import prismaMock from "@calcom/testing/lib/__mocks__/prisma";

import {
  BookingLocations,
  createBookingScenario,
  getBooker,
  getGoogleCalendarCredential,
  getOrganizer,
  getScenarioData,
  mockCalendarToHaveNoBusySlots,
  mockSuccessfulVideoMeetingCreation,
  TestData,
} from "@calcom/testing/lib/bookingScenario/bookingScenario";
import { getMockRequestDataForBooking } from "@calcom/testing/lib/bookingScenario/getMockRequestDataForBooking";
import { setupAndTeardown } from "@calcom/testing/lib/bookingScenario/setupAndTeardown";

import { Logger } from "tslog";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { BookingEmailSmsHandler } from "@calcom/features/bookings/lib/BookingEmailSmsHandler";
import EventManager from "@calcom/features/bookings/lib/EventManager";
import { resetTestEmails } from "@calcom/lib/testEmails";
import { BookingStatus } from "@calcom/prisma/enums";

const timeout = process.env.CI ? 5000 : 20000;
const MEETING_URL = "http://mock-dailyvideo.example.com/meeting-1";

type EmailSendInput = Parameters<BookingEmailSmsHandler["send"]>[0];

async function setupScenario() {
  const booker = getBooker({ email: "booker@example.com", name: "Booker" });
  const organizer = getOrganizer({
    name: "Organizer",
    email: "organizer@example.com",
    id: 101,
    schedules: [TestData.schedules.IstWorkHours],
    credentials: [getGoogleCalendarCredential()],
    selectedCalendars: [TestData.selectedCalendars.google],
  });

  await createBookingScenario(
    getScenarioData({
      eventTypes: [{ id: 1, slotInterval: 30, length: 30, users: [{ id: 101 }] }],
      organizer,
      apps: [TestData.apps["google-calendar"], TestData.apps["daily-video"]],
    })
  );
  const videoMock = mockSuccessfulVideoMeetingCreation({
    metadataLookupKey: "dailyvideo",
    videoMeetingData: { id: "MOCK_ID", password: "MOCK_PASS", url: MEETING_URL },
  });
  await mockCalendarToHaveNoBusySlots("googlecalendar", { create: { id: "MOCKED_GOOGLE_EVENT_ID" } });

  return { booker, videoMock };
}

// Calls the service directly: getNewBookingHandler waits for pending emails, which would hide the behaviour under test.
async function createBooking(booker: { email: string; name: string }) {
  const { getRegularBookingService } = await import(
    "@calcom/features/bookings/di/RegularBookingService.container"
  );
  return getRegularBookingService().createBooking({
    bookingData: getMockRequestDataForBooking({
      data: {
        eventTypeId: 1,
        responses: {
          email: booker.email,
          name: booker.name,
          location: { optionValue: "", value: BookingLocations.CalVideo },
        },
      },
    }),
  });
}

describe("BOOKING_ASYNC_INTEGRATIONS", () => {
  setupAndTeardown();

  beforeEach(() => {
    resetTestEmails();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test(
    "flag off: the meeting is created before the booking is returned",
    async () => {
      const { booker, videoMock } = await setupScenario();
      const sendSpy = vi.spyOn(BookingEmailSmsHandler.prototype, "send");

      const booking = await createBooking(booker);

      expect(videoMock.createMeetingCalls).toHaveLength(1);
      // Cal Video exposes its public /video/<uid> page as the booking's videoCallUrl.
      expect(booking.videoCallUrl).toContain(`/video/${booking.uid}`);
      expect(booking.references).toEqual(
        expect.arrayContaining([expect.objectContaining({ meetingUrl: MEETING_URL })])
      );
      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ action: "BOOKING_CONFIRMED" }));
    },
    timeout
  );

  test(
    "flag on: the booking returns before a slow meeting creation, and emails follow with the meeting link",
    async () => {
      vi.stubEnv("BOOKING_ASYNC_INTEGRATIONS", "true");
      const { booker, videoMock } = await setupScenario();

      const order: string[] = [];
      let releaseMeeting: () => void = () => undefined;
      const meetingGate = new Promise<void>((resolve) => {
        releaseMeeting = resolve;
      });
      const originalCreate = EventManager.prototype.create;
      vi.spyOn(EventManager.prototype, "create").mockImplementation(async function (
        this: EventManager,
        ...args: Parameters<EventManager["create"]>
      ) {
        await meetingGate;
        const result = await originalCreate.apply(this, args);
        order.push("meeting");
        return result;
      });
      const sendSpy = vi.spyOn(BookingEmailSmsHandler.prototype, "send").mockImplementation(async () => {
        order.push("emails");
      });

      const booking = await createBooking(booker);

      // Returned while the meeting is still being created.
      expect(booking.status).toBe(BookingStatus.ACCEPTED);
      expect(booking.uid).toBeTruthy();
      expect(booking.startTime).toBeInstanceOf(Date);
      expect(booking.references).toEqual([]);
      expect(booking.videoCallUrl).toBeUndefined();
      expect(videoMock.createMeetingCalls).toHaveLength(0);
      expect(sendSpy).not.toHaveBeenCalled();
      expect(await prismaMock.booking.findUnique({ where: { uid: booking.uid } })).toEqual(
        expect.objectContaining({ status: BookingStatus.ACCEPTED })
      );

      releaseMeeting();
      await vi.waitFor(() => expect(sendSpy).toHaveBeenCalled());

      expect(order).toEqual(["meeting", "emails"]);
      expect(videoMock.createMeetingCalls).toHaveLength(1);
      const emailInput = sendSpy.mock.calls[0][0] as EmailSendInput & {
        data: { evt: { videoCallData?: { url?: string } } };
      };
      expect(emailInput.action).toBe("BOOKING_CONFIRMED");
      expect(emailInput.data.evt.videoCallData?.url).toBe(MEETING_URL);

      const references = await prismaMock.bookingReference.findMany({ where: { bookingId: booking.id } });
      expect(references).toEqual(
        expect.arrayContaining([expect.objectContaining({ meetingUrl: MEETING_URL })])
      );
      const saved = await prismaMock.booking.findUnique({ where: { uid: booking.uid } });
      expect(saved?.metadata).toEqual(
        expect.objectContaining({ videoCallUrl: expect.stringContaining(`/video/${booking.uid}`) })
      );
    },
    timeout
  );

  test(
    "flag on: a background failure is logged with the booking uid and does not reject the booking",
    async () => {
      vi.stubEnv("BOOKING_ASYNC_INTEGRATIONS", "true");
      const { booker } = await setupScenario();
      vi.spyOn(EventManager.prototype, "create").mockRejectedValue(new Error("Graph unavailable"));
      const sendSpy = vi.spyOn(BookingEmailSmsHandler.prototype, "send");
      const errorSpy = vi.spyOn(Logger.prototype, "error");

      const booking = await createBooking(booker);

      expect(booking.status).toBe(BookingStatus.ACCEPTED);
      await vi.waitFor(() =>
        expect(errorSpy).toHaveBeenCalledWith(
          `[async-integrations] uid=${booking.uid} stage=create error=Graph unavailable`,
          expect.anything()
        )
      );
      expect(sendSpy).not.toHaveBeenCalled();
    },
    timeout
  );
});
