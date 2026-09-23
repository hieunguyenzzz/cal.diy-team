import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getBookingForReschedule } from "@calcom/features/bookings/lib/get-booking";
import { getBrandingForTeam } from "@calcom/features/profile/lib/getBranding";
import { shouldHideBrandingForTeamEvent } from "@calcom/features/profile/lib/hideBranding";
import { TeamRepository } from "@calcom/features/teams/repositories/TeamRepository";
import { getPlaceholderAvatar } from "@calcom/lib/defaultAvatarImage";
import logger from "@calcom/lib/logger";
import slugify from "@calcom/lib/slugify";
import { prisma } from "@calcom/prisma";
import type { User } from "@calcom/prisma/client";
import { BookingStatus, SchedulingType } from "@calcom/prisma/enums";
import { EventTypeMetaDataSchema } from "@calcom/prisma/zod-utils";
import type { GetServerSidePropsContext } from "next";
import { z } from "zod";

const paramsSchema = z.object({
  type: z.string().transform((s) => slugify(s)),
  slug: z.string().transform((s) => slugify(s)),
});

export const getServerSideProps = async (context: GetServerSidePropsContext) => {
  const { req, params, query } = context;
  const { slug: teamSlug, type: meetingSlug } = paramsSchema.parse(params);
  const { rescheduleUid } = query;
  const allowRescheduleForCancelledBooking = query.allowRescheduleForCancelledBooking === "true";
  const log = logger.getSubLogger({ prefix: ["team-event-ssr", `${teamSlug}/${meetingSlug}`] });

  const team = await new TeamRepository(prisma).findBySlugIncludeEventType({
    slug: teamSlug,
    eventTypeSlug: meetingSlug,
  });

  if (!team) {
    log.warn("Team not found", { slug: teamSlug, eventTypeSlug: meetingSlug });
    return { notFound: true } as const;
  }

  const eventData = team.eventTypes[0];

  // Managed event types are templates for members, not bookable on the team page
  if (!eventData || eventData.schedulingType === SchedulingType.MANAGED) {
    log.warn("Team event type not found", { slug: teamSlug, eventTypeSlug: meetingSlug });
    return { notFound: true } as const;
  }

  if (rescheduleUid && eventData.disableRescheduling) {
    return { redirect: { destination: `/booking/${rescheduleUid}`, permanent: false } };
  }

  const eventTypeId = eventData.id;

  const booking = rescheduleUid
    ? await getServerSession({ req })
        .then((session) => getBookingForReschedule(`${rescheduleUid}`, session?.user?.id))
        .catch((err) => {
          log.error("Failed to get booking for reschedule", err);
          throw err;
        })
    : null;

  if (
    booking?.status === BookingStatus.CANCELLED &&
    !allowRescheduleForCancelledBooking &&
    !eventData.allowReschedulingCancelledBookings
  ) {
    return {
      redirect: {
        permanent: false,
        destination: `/team/${teamSlug}/${meetingSlug}`,
      },
    };
  }

  return {
    props: {
      eventData: {
        eventTypeId,
        entity: {
          considerUnpublished: false,
          orgSlug: null,
          teamSlug: team.slug ?? null,
          name: team.name,
        },
        length: eventData.length,
        metadata: EventTypeMetaDataSchema.parse(eventData.metadata),
        profile: {
          image: getPlaceholderAvatar(team.logoUrl, team.name),
          name: team.name,
          username: null,
          ...getBrandingForTeam({ team }),
        },
        title: eventData.title,
        users: getUsersData(
          team.isPrivate,
          eventData.hosts.map((h) => h.user),
          eventData.users
        ),
        hidden: eventData.hidden,
        interfaceLanguage: eventData.interfaceLanguage,
      },
      booking,
      user: teamSlug,
      teamId: team.id,
      slug: meetingSlug,
      isBrandingHidden: shouldHideBrandingForTeamEvent({
        eventTypeId: eventData.id,
        team: { hideBranding: team.hideBranding, parent: null },
      }),
      themeBasis: null,
    },
  };
};

type PublicUser = Pick<User, "username" | "name">;

const getUsersData = (isPrivateTeam: boolean, hosts: PublicUser[], eventUsers: PublicUser[]) => {
  if (isPrivateTeam) return [];
  // Events without hosts fall back to their first assigned user
  const users = hosts.length > 0 ? hosts : eventUsers.slice(0, 1);
  return users
    .filter((user) => user.username)
    .map((user) => ({
      username: user.username ?? "",
      name: user.name ?? "",
    }));
};
