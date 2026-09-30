import type { BookingHandlerInput } from "@calcom/features/bookings/lib/dto/types";
import { vi } from "vitest";

async function handler(input: BookingHandlerInput) {
  const { getRegularBookingService } = await import(
    "@calcom/features/bookings/di/RegularBookingService.container"
  );
  const { BookingEmailSmsHandler } = await import("@calcom/features/bookings/lib/BookingEmailSmsHandler");
  const regularBookingService = getRegularBookingService();
  const { bookingData, ...bookingMeta } = input;
  // createBooking no longer awaits its emails, so wait for them here to let tests assert on sent emails.
  const sendSpy = vi.spyOn(BookingEmailSmsHandler.prototype, "send");
  try {
    const booking = await regularBookingService.createBooking({
      bookingData,
      bookingMeta,
    });
    await Promise.allSettled(sendSpy.mock.results.map((result) => result.value));
    return booking;
  } finally {
    sendSpy.mockRestore();
  }
}

export function getNewBookingHandler() {
  return handler;
}
