import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { UserPermissionRole } from "@calcom/prisma/enums";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { PageProps } from "app/_types";
import { _generateMetadata } from "app/_utils";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import TeamProfileView from "~/settings/teams/views/team-profile-view";

export const generateMetadata = async ({ params }: { params: Promise<{ id: string }> }) =>
  await _generateMetadata(
    (t) => t("profile"),
    (t) => t("profile_team_description"),
    undefined,
    undefined,
    `/settings/teams/${(await params).id}/profile`
  );

const Page = async ({ params }: PageProps) => {
  const { id } = (await params) ?? {};
  const teamId = typeof id === "string" && /^[1-9]\d*$/.test(id) ? Number(id) : null;
  if (teamId === null) notFound();

  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) {
    redirect(`/auth/login?callbackUrl=/settings/teams/${teamId}/profile`);
  }

  // Membership and role checks live in viewer.teams.get/update; the view renders their FORBIDDEN/NOT_FOUND.
  return <TeamProfileView teamId={teamId} isInstanceAdmin={session.user.role === UserPermissionRole.ADMIN} />;
};

export default Page;
