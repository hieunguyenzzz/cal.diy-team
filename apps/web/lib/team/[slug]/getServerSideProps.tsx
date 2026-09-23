import { ProfileRepository } from "@calcom/features/profile/repositories/ProfileRepository";
import { TeamRepository } from "@calcom/features/teams/repositories/TeamRepository";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { getUserAvatarUrl } from "@calcom/lib/getAvatarUrl";
import logger from "@calcom/lib/logger";
import { markdownToSafeHTML } from "@calcom/lib/markdownToSafeHTML";
import slugify from "@calcom/lib/slugify";
import { stripMarkdown } from "@calcom/lib/stripMarkdown";
import { prisma } from "@calcom/prisma";
import { EventTypeMetaDataSchema } from "@calcom/prisma/zod-utils";
import type { GetServerSidePropsContext } from "next";

const log = logger.getSubLogger({ prefix: ["team/[slug]"] });

type PublicUser = { id: number; name: string | null; username: string | null; avatarUrl: string | null };

const toPublicUser = (user: PublicUser) => ({
  name: user.name,
  username: user.username,
  avatarUrl: user.avatarUrl,
  avatar: getUserAvatarUrl(user),
  profile: ProfileRepository.buildPersonalProfileFromUser({ user }),
});

export const getServerSideProps = async (context: GetServerSidePropsContext) => {
  const slug = typeof context.query.slug === "string" ? slugify(context.query.slug) : "";
  if (!slug) return { notFound: true } as const;

  const team = await new TeamRepository(prisma).findBySlugIncludeEventTypesAndMembers({ slug });
  if (!team) {
    log.warn("Team not found", { slug });
    return { notFound: true } as const;
  }

  const eventTypes = team.eventTypes.map(({ hosts, description, metadata, ...eventType }) => ({
    ...eventType,
    metadata: EventTypeMetaDataSchema.parse(metadata ?? {}),
    descriptionAsSafeHTML: markdownToSafeHTML(description),
    users: team.isPrivate ? [] : hosts.map(({ user }) => toPublicUser(user)),
  }));

  const members = team.isPrivate
    ? []
    : team.members.map(({ user }) => ({
        ...toPublicUser(user),
        id: user.id,
        bio: user.bio,
        safeBio: markdownToSafeHTML(user.bio || ""),
        bookerUrl: WEBAPP_URL,
      }));

  return {
    props: {
      team: {
        id: team.id,
        slug: team.slug,
        name: team.name,
        bio: team.bio,
        safeBio: markdownToSafeHTML(team.bio) || "",
        theme: team.theme,
        isPrivate: team.isPrivate,
        hideBookATeamMember: team.hideBookATeamMember,
        logoUrl: team.logoUrl,
        brandColor: team.brandColor,
        darkBrandColor: team.darkBrandColor,
        eventTypes,
        members,
      },
      themeBasis: team.slug,
      markdownStrippedBio: stripMarkdown(team.bio || ""),
    },
  } as const;
};
