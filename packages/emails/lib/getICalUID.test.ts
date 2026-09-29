import { describe, expect } from "vitest";

import { WEBAPP_URL } from "@calcom/lib/constants";
import { buildCalendarEvent } from "@calcom/lib/test/builder";
import { test } from "@calcom/testing/lib/fixtures/fixtures";

import getICalUID from "./getICalUID";

const UID_DOMAIN: string = new URL(WEBAPP_URL).hostname;

describe("getICalUid", () => {
  test("returns iCalUID when passing a uid", () => {
    const iCalUID = getICalUID({ uid: "123" });
    expect(iCalUID).toEqual(`123@${UID_DOMAIN}`);
  });
  test("returns iCalUID when passing an event", () => {
    const event = buildCalendarEvent({ iCalUID: `123@${UID_DOMAIN}` });
    const iCalUID = getICalUID({ event });
    expect(iCalUID).toEqual(`123@${UID_DOMAIN}`);
  });
  test("returns new iCalUID when passing in an event with no iCalUID but has an uid", () => {
    const event = buildCalendarEvent({ iCalUID: "" });
    const iCalUID = getICalUID({ event, defaultToEventUid: true });
    expect(iCalUID).toEqual(`${event.uid}@${UID_DOMAIN}`);
  });
  test("returns new iCalUID when passing in an event with no iCalUID and uses uid passed", () => {
    const event = buildCalendarEvent({ iCalUID: "" });
    const iCalUID = getICalUID({ event, uid: "123" });
    expect(iCalUID).toEqual(`123@${UID_DOMAIN}`);
  });
});
