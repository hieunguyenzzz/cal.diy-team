import type { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { TEAM_ADMIN_ROLES } from "@calcom/features/teams/lib/teamEventTypeRoles";
import type { TeamProfileUpdate, TeamRepository } from "@calcom/features/teams/repositories/TeamRepository";
import type { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { ErrorWithCode } from "@calcom/lib/errors";
import slugify from "@calcom/lib/slugify";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import type { TeamPermissionService } from "./TeamPermissionService";

type Actor = { userId: number; userRole: UserPermissionRole | null | undefined };

type TeamProfileInput = {
  name?: string;
  slug?: string;
  bio?: string | null;
  timeZone?: string;
  // A data URL uploads a new logo; null removes the current one.
  logo?: string | null;
};

interface ITeamServiceDeps {
  teamRepository: TeamRepository;
  membershipRepository: MembershipRepository;
  userRepository: Pick<UserRepository, "findByEmail">;
  teamPermissionService: TeamPermissionService;
  uploadLogo: (args: { teamId: number; logo: string }) => Promise<string>;
}

const OWNER_ONLY: readonly MembershipRole[] = [MembershipRole.OWNER];

// Only types /api/avatar can serve: it strips png/jpeg prefixes, and SVG is converted to PNG on upload.
const LOGO_DATA_URL = /^data:image\/(png|jpeg|svg\+xml);base64,/;
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
// Capping the raw length first stops padding from shrinking the size estimate below.
const MAX_LOGO_BASE64_LENGTH = Math.ceil(MAX_LOGO_BYTES / 3) * 4;

class TeamService {
  constructor(private readonly deps: ITeamServiceDeps) {}

  async createTeam(
    actor: Actor,
    input: { name: string; slug?: string; bio?: string | null; timeZone?: string }
  ) {
    this.assertInstanceAdmin(actor, "Only instance admins can create teams");
    const slug = await this.resolveAvailableSlug(input.slug ?? input.name);

    return this.deps.teamRepository.create({
      name: input.name,
      slug,
      bio: input.bio,
      timeZone: input.timeZone,
      ownerUserId: actor.userId,
    });
  }

  async updateTeam(actor: Actor, teamId: number, input: TeamProfileInput) {
    await this.assertTeamRole(actor, teamId, TEAM_ADMIN_ROLES, "Only team admins can update the team");
    await this.findTeamOrThrow(teamId);

    const { logo, slug, ...profile } = input;
    const data: TeamProfileUpdate = { ...profile };
    if (slug !== undefined) data.slug = await this.resolveAvailableSlug(slug, teamId);
    if (logo !== undefined) {
      if (logo !== null) this.assertValidLogo(logo);
      data.logoUrl = logo === null ? null : await this.deps.uploadLogo({ teamId, logo });
    }

    return this.deps.teamRepository.update({ id: teamId, data });
  }

  async deleteTeam(actor: Actor, teamId: number) {
    this.assertInstanceAdmin(actor, "Only instance admins can delete teams");
    await this.findTeamOrThrow(teamId);
    await this.deps.teamRepository.delete({ id: teamId });
    await this.deps.teamRepository.deleteLogos({ teamId });
  }

  // Deleting a team keeps its bookings but unlinks them from their event type; the UI warns with this count.
  async countUpcomingBookings(actor: Actor, teamId: number) {
    this.assertInstanceAdmin(actor, "Only instance admins can inspect a team before deleting it");
    await this.findTeamOrThrow(teamId);
    return this.deps.teamRepository.countUpcomingBookings({ teamId, now: new Date() });
  }

  async addMemberByEmail(actor: Actor, teamId: number, input: { email: string; role: MembershipRole }) {
    // Product decision: only instance admins add people to teams; team admins manage existing members.
    this.assertInstanceAdmin(actor, "Only instance admins can add members to a team");
    await this.findTeamOrThrow(teamId);

    const user = await this.deps.userRepository.findByEmail({ email: input.email });
    if (!user) {
      throw ErrorWithCode.Factory.NotFound(
        `No user has the email ${input.email}. Create the user first at /settings/admin/users/add.`
      );
    }
    if (
      await this.deps.membershipRepository.findRoleAndAcceptedByUserIdAndTeamId({ userId: user.id, teamId })
    ) {
      throw ErrorWithCode.Factory.BadRequest("This user is already a member of the team");
    }

    // No invitation flow: the admin vouches for the user, so the membership starts accepted.
    return this.deps.membershipRepository.createAccepted({ teamId, userId: user.id, role: input.role });
  }

  async changeMemberRole(actor: Actor, teamId: number, userId: number, role: MembershipRole) {
    await this.assertTeamRole(actor, teamId, TEAM_ADMIN_ROLES, "Only team admins can change roles");
    await this.findTeamOrThrow(teamId);
    const target = await this.findMembershipOrThrow(teamId, userId);

    const touchesOwner = target.role === MembershipRole.OWNER || role === MembershipRole.OWNER;
    if (touchesOwner) {
      await this.assertTeamRole(actor, teamId, OWNER_ONLY, "Only an owner can grant or revoke owner");
    }
    if (target.role === MembershipRole.OWNER && target.accepted && role !== MembershipRole.OWNER) {
      await this.assertNotLastOwner(teamId);
    }

    return this.deps.membershipRepository.updateRole({ teamId, userId, role });
  }

  async removeMember(actor: Actor, teamId: number, userId: number) {
    const isSelf = actor.userId === userId;
    if (!isSelf) {
      await this.assertTeamRole(actor, teamId, TEAM_ADMIN_ROLES, "Only team admins can remove members");
    }
    await this.findTeamOrThrow(teamId);
    const target = await this.findMembershipOrThrow(teamId, userId);
    // Any accepted member may leave; a pending invitee has no say in the team yet.
    const isLeaving = isSelf && target.accepted;
    if (isSelf && !isLeaving) {
      await this.assertTeamRole(actor, teamId, TEAM_ADMIN_ROLES, "Only team admins can remove members");
    }

    if (target.role === MembershipRole.OWNER) {
      if (!isLeaving) {
        await this.assertTeamRole(actor, teamId, OWNER_ONLY, "Only an owner can remove an owner");
      }
      if (target.accepted) await this.assertNotLastOwner(teamId);
    }

    await this.deps.membershipRepository.deleteByUserIdAndTeamId({ teamId, userId });
  }

  private assertValidLogo(logo: string) {
    const prefix = LOGO_DATA_URL.exec(logo);
    if (!prefix) {
      throw ErrorWithCode.Factory.BadRequest("The logo must be a base64 PNG, JPEG or SVG data URL");
    }
    const base64 = logo.slice(prefix[0].length);
    const tooLarge = () => ErrorWithCode.Factory.BadRequest("The logo must be 2 MB or smaller");
    if (base64.length > MAX_LOGO_BASE64_LENGTH) throw tooLarge();
    if (!BASE64_BODY.test(base64)) throw ErrorWithCode.Factory.BadRequest("The logo is not valid base64");
    const padding = /=*$/.exec(base64)?.[0].length ?? 0;
    if (Math.floor((base64.length * 3) / 4) - padding > MAX_LOGO_BYTES) throw tooLarge();
  }

  private assertInstanceAdmin(actor: Actor, message: string) {
    if (actor.userRole !== UserPermissionRole.ADMIN) throw ErrorWithCode.Factory.Forbidden(message);
  }

  private async assertTeamRole(
    actor: Actor,
    teamId: number,
    roles: readonly MembershipRole[],
    message: string
  ) {
    const allowed = await this.deps.teamPermissionService.hasTeamRole({
      userId: actor.userId,
      userRole: actor.userRole,
      teamId,
      roles,
    });
    if (!allowed) throw ErrorWithCode.Factory.Forbidden(message);
  }

  private async findTeamOrThrow(teamId: number) {
    const team = await this.deps.teamRepository.findById({ id: teamId });
    if (!team) throw ErrorWithCode.Factory.NotFound(`Team ${teamId} not found`);
    return team;
  }

  private async findMembershipOrThrow(teamId: number, userId: number) {
    const membership = await this.deps.membershipRepository.findRoleAndAcceptedByUserIdAndTeamId({
      userId,
      teamId,
    });
    if (!membership) throw ErrorWithCode.Factory.NotFound(`User ${userId} is not a member of team ${teamId}`);
    return membership;
  }

  // Read-then-write: two concurrent demotions could still leave no owner. Accepted for v1, since only a
  // handful of instance admins manage teams here; a transaction or partial index would close it.
  private async assertNotLastOwner(teamId: number) {
    const owners = await this.deps.membershipRepository.countAcceptedOwners({ teamId });
    if (owners <= 1) {
      throw ErrorWithCode.Factory.BadRequest("A team must keep at least one owner; this is the last owner");
    }
  }

  // @@unique([slug, parentId]) does not stop duplicates when parentId is NULL, so check explicitly.
  private async resolveAvailableSlug(rawSlug: string, currentTeamId?: number) {
    const slug = slugify(rawSlug);
    if (!slug)
      throw ErrorWithCode.Factory.BadRequest("A team needs a name or slug made of letters or digits");

    // Read-then-write: two concurrent requests could still claim the same slug. Accepted for v1 because
    // team changes are rare and done by a few instance admins.
    const existing = await this.deps.teamRepository.findIdBySlugAmongTopLevelTeams({ slug });
    if (existing && existing.id !== currentTeamId) {
      throw ErrorWithCode.Factory.BadRequest(`The slug "${slug}" is already taken by another team`);
    }
    return slug;
  }
}

export { TeamService };
export type { ITeamServiceDeps };
