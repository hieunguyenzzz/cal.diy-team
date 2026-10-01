import { z } from "zod";

const senderSchema = z.object({
  address: z.string().email().optional(),
  name: z.string().min(1).optional(),
});

export type TeamSender = z.infer<typeof senderSchema>;
export type TeamSenderMap = Record<string, TeamSender>;

/**
 * Parses EMAIL_SENDER_BY_TEAM, e.g. {"3":{"address":"bookings@example.com","name":"Example"}}.
 * Never throws: invalid JSON or entries are logged and ignored so email sending keeps working.
 */
export const parseTeamSenderMap = (raw: string | undefined): TeamSenderMap => {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("[email-sender] EMAIL_SENDER_BY_TEAM is not valid JSON, ignoring", e);
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.error("[email-sender] EMAIL_SENDER_BY_TEAM must be a JSON object, ignoring");
    return {};
  }
  const map: TeamSenderMap = {};
  for (const [teamId, entry] of Object.entries(parsed)) {
    const result = senderSchema.safeParse(entry);
    if (!result.success) {
      console.error(`[email-sender] EMAIL_SENDER_BY_TEAM entry for team=${teamId} is invalid, ignoring`);
      continue;
    }
    map[teamId] = result.data;
  }
  return map;
};

let cachedMap: TeamSenderMap | undefined;
const getTeamSenderMap = () => {
  if (cachedMap === undefined) cachedMap = parseTeamSenderMap(process.env.EMAIL_SENDER_BY_TEAM);
  return cachedMap;
};

/** Returns the `from` header with the team's sender override applied, or null when no override applies. */
export const applyTeamSender = (
  from: string,
  teamId: number | undefined,
  map: TeamSenderMap = getTeamSenderMap()
): string | null => {
  if (teamId === undefined) return null;
  const sender = map[String(teamId)];
  if (!sender || (!sender.address && !sender.name)) return null;

  const match = from.match(/^(.*?)\s<(.*)>$/);
  const currentName = match ? match[1] : "";
  const currentAddress = match ? match[2] : from;

  const name = sender.name ?? currentName;
  const address = sender.address ?? currentAddress;
  return name ? `${name} <${address}>` : address;
};
