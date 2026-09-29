import short from "short-uuid";
import { v4 as uuidv4 } from "uuid";

import { WEBAPP_URL } from "@calcom/lib/constants";

// RFC 5545 recommends a domain on the right of "@". APP_NAME can contain spaces
// (e.g. "SoundBox Store"), which calendar providers may reject in an iCalUID.
const UID_DOMAIN: string = new URL(WEBAPP_URL).hostname;

/**
 * This function returns the iCalUID if a uid is passed or if it is present in the event that is passed
 * @param uid - the uid of the event
 * @param event - an event that already has an iCalUID or one that has a uid
 * @param defaultToEventUid - if true, will default to the event.uid if present
 *
 * @returns the iCalUID whether already present or generated
 */
const getICalUID = ({
  uid,
  event,
  defaultToEventUid,
  attendeeId,
}: {
  uid?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event?: { iCalUID?: string | null; uid?: string | null; [key: string]: any };
  defaultToEventUid?: boolean;
  attendeeId?: number;
}) => {
  if (event?.iCalUID) return event.iCalUID;

  if (defaultToEventUid && event?.uid) return `${event.uid}@${UID_DOMAIN}`;

  if (uid) return `${uid}@${UID_DOMAIN}`;

  const translator = short();

  uid = translator.fromUUID(uuidv4());
  return `${uid}${attendeeId ? `${attendeeId}` : ""}@${UID_DOMAIN}`;
};

export default getICalUID;
