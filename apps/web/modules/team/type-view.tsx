"use client";

import { getBookerWrapperClasses } from "@calcom/features/bookings/Booker/utils/getBookerWrapperClasses";
import { BookerWebWrapper as Booker } from "@calcom/web/modules/bookings/components/BookerWebWrapper";
import BookingPageErrorBoundary from "@components/error/BookingPageErrorBoundary";
import type { getServerSideProps } from "@lib/team/[slug]/[type]/getServerSideProps";
import type { inferSSRProps } from "@lib/types/inferSSRProps";
import type { EmbedProps } from "app/WithEmbedSSR";
import { useSearchParams } from "next/navigation";

export type PageProps = inferSSRProps<typeof getServerSideProps> & EmbedProps;

export const getMultipleDurationValue = (
  multipleDurationConfig: number[] | undefined,
  queryDuration: string | string[] | null | undefined,
  defaultValue: number
) => {
  if (!multipleDurationConfig) return null;
  if (multipleDurationConfig.includes(Number(queryDuration))) return Number(queryDuration);
  return defaultValue;
};

function Type({ slug, user, booking, isBrandingHidden, eventData, isEmbed }: PageProps) {
  const searchParams = useSearchParams();

  return (
    <BookingPageErrorBoundary>
      <main className={getBookerWrapperClasses({ isEmbed: !!isEmbed })}>
        <Booker
          // useScheduleForEvent defaults to API v2 slots for team events; this app serves slots over tRPC
          useApiV2={false}
          username={user}
          eventSlug={slug}
          bookingData={booking}
          hideBranding={isBrandingHidden}
          isTeamEvent
          entity={{ ...eventData.entity, eventTypeId: eventData?.eventTypeId }}
          durationConfig={eventData.metadata?.multipleDuration}
          /* TODO: Currently unused, evaluate it is needed-
           *       Possible alternative approach is to have onDurationChange.
           */
          duration={getMultipleDurationValue(
            eventData.metadata?.multipleDuration,
            searchParams?.get("duration"),
            eventData.length
          )}
        />
      </main>
    </BookingPageErrorBoundary>
  );
}

export default Type;
