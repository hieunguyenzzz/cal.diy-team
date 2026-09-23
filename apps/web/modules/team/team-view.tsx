"use client";

import { sdkActionManager, useIsEmbed } from "@calcom/embed-core/embed-iframe";
import { getOrgOrTeamAvatar } from "@calcom/lib/defaultAvatarImage";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { useRouterQuery } from "@calcom/lib/hooks/useRouterQuery";
import useTheme from "@calcom/lib/hooks/useTheme";
import { Avatar, AvatarGroup } from "@calcom/ui/components/avatar";
import { Button } from "@calcom/ui/components/button";
import EventTypeDescription from "@calcom/web/modules/event-types/components/EventTypeDescription";
import Team from "@components/team/screens/Team";
import { useToggleQuery } from "@lib/hooks/useToggleQuery";
import type { getServerSideProps } from "@lib/team/[slug]/getServerSideProps";
import type { inferSSRProps } from "@lib/types/inferSSRProps";
import classNames from "classnames";
import Link from "next/link";

export type PageProps = inferSSRProps<typeof getServerSideProps>;
function TeamPage({ team }: PageProps) {
  useTheme(team.theme);
  const routerQuery = useRouterQuery();
  const showMembers = useToggleQuery("members");
  const { t } = useLocale();
  const isEmbed = useIsEmbed();
  const teamName = team.name || t("nameless_team");
  const isBioEmpty = !team.bio || !team.bio.replace("<p><br></p>", "").length;

  // slug is a route parameter, we don't want to forward it to the next route
  const { slug: _slug, orgSlug: _orgSlug, user: _user, ...queryParamsToForward } = routerQuery;

  const EventTypes = ({ eventTypes }: { eventTypes: NonNullable<(typeof team)["eventTypes"]> }) => (
    <ul className="border-subtle rounded-md border">
      {eventTypes.map((type, index) => (
        <li
          key={index}
          className={classNames(
            "bg-default hover:bg-cal-muted border-subtle group relative border-b transition first:rounded-t-md last:rounded-b-md last:border-b-0",
            !isEmbed && "bg-default"
          )}>
          <div className="px-6 py-4 ">
            <Link
              prefetch={false}
              href={{
                pathname: `/team/${team.slug}/${type.slug}`,
                query: queryParamsToForward,
              }}
              onClick={async () => {
                sdkActionManager?.fire("eventTypeSelected", {
                  eventType: type,
                });
              }}
              data-testid="event-type-link"
              className="flex justify-between">
              <div className="shrink">
                <div className="flex flex-wrap items-center space-x-2 rtl:space-x-reverse">
                  <h2 className=" text-default text-sm font-semibold">{type.title}</h2>
                </div>
                <EventTypeDescription className="text-sm" eventType={type} />
              </div>
              <div className="mt-1 self-center">
                {/* Plain avatars: linked ones would nest <a> inside the event type link */}
                <AvatarGroup
                  truncateAfter={4}
                  className="flex shrink-0"
                  size="sm"
                  items={type.users.map((user) => ({
                    href: null,
                    alt: user.name ?? "",
                    title: user.name ?? "",
                    image: user.avatar,
                  }))}
                />
              </div>
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );

  const profileImageSrc = getOrgOrTeamAvatar(team);

  return (
    <>
      <main className="dark:bg-default bg-subtle mx-auto max-w-3xl rounded-md px-4 pb-12 pt-12">
        <div className="mx-auto mb-8 max-w-3xl text-center">
          <div className="relative">
            <Avatar alt={teamName} imageSrc={profileImageSrc} size="lg" />
          </div>
          <p className="font-cal  text-emphasis mb-2 text-2xl tracking-wider" data-testid="team-name">
            {teamName}
          </p>
          {!isBioEmpty && (
            <div
              className="  text-subtle wrap-break-word text-sm [&_a]:text-blue-500 [&_a]:underline [&_a]:hover:text-blue-600"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: Content is sanitized via safeBio
              dangerouslySetInnerHTML={{ __html: team.safeBio }}
            />
          )}
        </div>
        {(showMembers.isOn || !team.eventTypes?.length) &&
          (team.isPrivate ? (
            <div className="w-full text-center">
              <h2 data-testid="you-cannot-see-team-members" className="text-emphasis font-semibold">
                {t("you_cannot_see_team_members")}
              </h2>
            </div>
          ) : (
            <Team members={team.members} teamName={team.name} />
          ))}
        {!showMembers.isOn && team.eventTypes && team.eventTypes.length > 0 && (
          <div className="mx-auto max-w-3xl ">
            <EventTypes eventTypes={team.eventTypes} />

            {/* Hide "Book a team member" button when team is private or hideBookATeamMember is true */}
            {!team.hideBookATeamMember && !team.isPrivate && (
              <div>
                <div className="relative mt-12">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="border-subtle w-full border-t" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-subtle text-subtle px-2 text-sm">{t("or")}</span>
                  </div>
                </div>

                <aside className="dark:text-inverted mt-8 flex justify-center text-center">
                  <Button
                    color="minimal"
                    EndIcon="arrow-right"
                    data-testid="book-a-team-member-btn"
                    className="dark:hover:bg-darkgray-200"
                    href={{
                      pathname: `/team/${team.slug}`,
                      query: {
                        ...queryParamsToForward,
                        members: "1",
                      },
                    }}
                    shallow={true}>
                    {t("book_a_team_member")}
                  </Button>
                </aside>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}

export default TeamPage;
