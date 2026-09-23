import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { UserPermissionRole } from "@calcom/prisma/enums";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { PageProps } from "app/_types";
import { _generateMetadata } from "app/_utils";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import TeamMembersView from "~/settings/teams/views/team-members-view";

export const generateMetadata = async ({ params }: { params: Promise<{ id: string }> }) =>
  await _generateMetadata(
    (t) => t("team_members"),
    (t) => t("members_team_description"),
    undefined,
    undefined,
    `/settings/teams/${(await params).id}/members`
  );

const Page = async ({ params }: PageProps) => {
  const { id } = (await params) ?? {};
  const teamId = typeof id === "string" && /^[1-9]\d*$/.test(id) ? Number(id) : null;
  if (teamId === null) notFound();

  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) {
    redirect(`/auth/login?callbackUrl=/settings/teams/${teamId}/members`);
  }

  // Membership and role checks live in viewer.teams.get/listMembers; the view renders FORBIDDEN/NOT_FOUND.
  return (
    <TeamMembersView
      teamId={teamId}
      currentUserId={session.user.id}
      isInstanceAdmin={session.user.role === UserPermissionRole.ADMIN}
    />
  );
};

export default Page;
