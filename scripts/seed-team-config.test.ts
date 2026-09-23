import { describe, expect, it } from "vitest";
import exampleConfig from "./seed-team.example.json";
import {
  describeTargetDatabase,
  displayNameFromEmail,
  parseTeamSeedConfig,
  pickUniqueUsername,
  planHostChanges,
  TeamSeedInputError,
  toCaseInsensitiveEmailPattern,
  toEventTypeLocations,
  usernameBaseFromEmail,
} from "./seed-team-config";

const validConfig = () => ({
  team: { name: "Test Team", slug: "test-team", timeZone: "Europe/London" },
  members: ["a@example.com", "b@example.com"],
  eventTypes: [
    {
      slug: "visit",
      title: "Visit",
      length: 60,
      schedulingType: "COLLECTIVE",
      hosts: ["a@example.com"],
      location: { type: "attendeeInPerson" },
    },
  ],
});

describe("parseTeamSeedConfig", () => {
  it("accepts the committed example config", () => {
    const config = parseTeamSeedConfig(exampleConfig);
    expect(config.team.slug).toBe("example-team");
    expect(config.eventTypes).toHaveLength(3);
  });

  it("ignores '_' comment keys at any depth and defaults users to []", () => {
    const raw = { _source: "x", ...validConfig(), team: { ...validConfig().team, _note: "y" } };
    const config = parseTeamSeedConfig(raw);
    expect(config.users).toEqual([]);
    expect(config.team).toEqual({ name: "Test Team", slug: "test-team", timeZone: "Europe/London" });
  });

  it("lowercases emails", () => {
    const raw = validConfig();
    raw.members = ["A@Example.com", "b@example.com"];
    raw.eventTypes[0].hosts = ["a@EXAMPLE.com"];
    expect(parseTeamSeedConfig(raw).members[0]).toBe("a@example.com");
  });

  it("throws a TeamSeedInputError so the CLI can print just the message", () => {
    expect(() => parseTeamSeedConfig({})).toThrow(TeamSeedInputError);
  });

  it("rejects hosts that are not members", () => {
    const raw = validConfig();
    raw.eventTypes[0].hosts = ["stranger@example.com"];
    expect(() => parseTeamSeedConfig(raw)).toThrow(
      /eventTypes\.0\.hosts\.0: host stranger@example.com is not in members/
    );
  });

  it("rejects duplicate event type slugs", () => {
    const raw = validConfig();
    raw.eventTypes.push({ ...raw.eventTypes[0] });
    expect(() => parseTeamSeedConfig(raw)).toThrow(/eventTypes\.1\.slug: duplicate event type slug visit/);
  });

  it("rejects an unknown schedulingType", () => {
    const raw = validConfig();
    raw.eventTypes[0].schedulingType = "MANAGED";
    expect(() => parseTeamSeedConfig(raw)).toThrow(/eventTypes\.0\.schedulingType/);
  });

  it("rejects duplicate members and users overlapping members", () => {
    const raw = { ...validConfig(), members: ["a@example.com", "a@example.com"], users: ["a@example.com"] };
    expect(() => parseTeamSeedConfig(raw)).toThrow(/members\.1: duplicate member[\s\S]*users\.0/);
  });

  it("rejects unknown keys, bad slugs, bad time zones and non-positive lengths", () => {
    const raw = {
      ...validConfig(),
      extra: true,
      team: { name: "T", slug: "Not A Slug", timeZone: "Mars/Olympus" },
      eventTypes: [{ ...validConfig().eventTypes[0], length: 0 }],
    };
    const message = (() => {
      try {
        parseTeamSeedConfig(raw);
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(message).toMatch(/^Invalid team seed config:/);
    expect(message).toMatch(/extra/);
    expect(message).toMatch(/team\.slug: must be a lowercase URL slug/);
    expect(message).toMatch(/team\.timeZone: must be a valid IANA time zone/);
    expect(message).toMatch(/eventTypes\.0\.length/);
  });

  it.each([
    [
      "an http link",
      { type: "link", link: "http://meet.example.com/room" },
      /location\.link: must be an https:\/\/ URL/,
    ],
    ["a non-URL link", { type: "link", link: "not a url" }, /location\.link: Invalid url/],
    [
      "a javascript: link",
      { type: "link", link: "javascript:alert(1)" },
      /location\.link: must be an https:\/\/ URL/,
    ],
    ["a protocol-relative link", { type: "link", link: "//evil.com/x" }, /location\.link: Invalid url/],
    ["a link without a URL", { type: "link" }, /location\.link: Required/],
    [
      "an address on attendeeInPerson",
      { type: "attendeeInPerson", address: "x" },
      /location: Unrecognized key/,
    ],
  ])("rejects %s", (_label, location, expected) => {
    const raw = validConfig();
    Object.assign(raw.eventTypes[0], { location });
    expect(() => parseTeamSeedConfig(raw)).toThrow(expected);
  });

  it("trims whitespace around a link before validating and storing it", () => {
    const raw = validConfig();
    Object.assign(raw.eventTypes[0], {
      location: { type: "link", link: "  https://meet.example.com/room \n" },
    });
    const location = parseTeamSeedConfig(raw).eventTypes[0].location;
    expect(location).toEqual({ type: "link", link: "https://meet.example.com/room" });
    expect(toEventTypeLocations(location)).toEqual([
      { type: "link", link: "https://meet.example.com/room", displayLocationPublicly: false },
    ]);
  });

  it("rejects an event type without a location, naming its path", () => {
    const { location: _location, ...withoutLocation } = validConfig().eventTypes[0];
    const raw = { ...validConfig(), eventTypes: [withoutLocation] };
    expect(() => parseTeamSeedConfig(raw)).toThrow(
      /eventTypes\.0\.location: is required \(inPerson, attendeeInPerson or link\)/
    );
  });

  it("rejects an unknown location type", () => {
    const raw = validConfig();
    Object.assign(raw.eventTypes[0], { location: { type: "zoom", address: "x" } });
    expect(() => parseTeamSeedConfig(raw)).toThrow(/eventTypes\.0\.location\.type/);
  });
});

describe("username derivation", () => {
  it("slugifies the email local part", () => {
    expect(usernameBaseFromEmail("jane.doe@example.com")).toBe("jane.doe");
    expect(usernameBaseFromEmail("Sales_Team+x@example.com")).toBe("sales-team-x");
  });

  it("keeps the base when free and adds the lowest free suffix on collision", () => {
    expect(pickUniqueUsername("alice", new Set())).toBe("alice");
    expect(pickUniqueUsername("alice", new Set(["alice"]))).toBe("alice-2");
    expect(pickUniqueUsername("alice", new Set(["alice", "alice-2", "alice-3"]))).toBe("alice-4");
  });

  it("builds a display name from the local part", () => {
    expect(displayNameFromEmail("jane.doe@example.com")).toBe("Jane Doe");
    expect(displayNameFromEmail("alice@example.com")).toBe("Alice");
  });
});

describe("planHostChanges", () => {
  it("is a no-op when hosts already match", () => {
    const hosts = [
      { userId: 1, isFixed: true },
      { userId: 2, isFixed: true },
    ];
    expect(planHostChanges(hosts, hosts)).toEqual({ create: [], update: [], removeUserIds: [] });
  });

  it("creates missing hosts, fixes isFixed and removes hosts no longer configured", () => {
    const existing = [
      { userId: 1, isFixed: false },
      { userId: 3, isFixed: true },
    ];
    const desired = [
      { userId: 1, isFixed: true, memberId: 10 },
      { userId: 2, isFixed: true, memberId: 20 },
    ];
    expect(planHostChanges(existing, desired)).toEqual({
      create: [{ userId: 2, isFixed: true, memberId: 20 }],
      update: [{ userId: 1, isFixed: true, memberId: 10 }],
      removeUserIds: [3],
    });
  });
});

describe("toEventTypeLocations", () => {
  it("maps an inPerson location to Cal's shape with the address shown publicly", () => {
    expect(toEventTypeLocations({ type: "inPerson", address: "1 Example Street" })).toEqual([
      { type: "inPerson", address: "1 Example Street", displayLocationPublicly: true },
    ]);
  });

  it("maps attendeeInPerson to a bare attendee-address location", () => {
    expect(toEventTypeLocations({ type: "attendeeInPerson" })).toEqual([{ type: "attendeeInPerson" }]);
  });

  it("maps a link location and keeps the link private until booking", () => {
    expect(toEventTypeLocations({ type: "link", link: "https://meet.example.com/room" })).toEqual([
      { type: "link", link: "https://meet.example.com/room", displayLocationPublicly: false },
    ]);
  });
});

describe("describeTargetDatabase", () => {
  it("returns host, port and database without credentials", () => {
    const described = describeTargetDatabase(
      "postgresql://calcom:s3cret@db.internal:5480/calendso?schema=public"
    );
    expect(described).toBe("db.internal:5480/calendso");
    expect(described).not.toMatch(/calcom|s3cret/);
  });

  it("defaults the port to 5432", () => {
    expect(describeTargetDatabase("postgresql://u:p@localhost/calendso")).toBe("localhost:5432/calendso");
  });

  it("keeps a normal URL with a query string", () => {
    expect(describeTargetDatabase("postgresql://u:p%2Fw@db.internal:5480/calendso?sslmode=require")).toBe(
      "db.internal:5480/calendso"
    );
  });

  it.each([
    ["an unencoded '/'", "postgresql://u:1234/ss@host/db"],
    ["an unencoded '#'", "postgresql://u:12#34@host/db"],
    ["an unencoded '?'", "postgresql://u:12?34@host/db"],
    ["a ';' suffix", "postgresql://u:pw@host/db;secret"],
  ])("refuses a password with %s without echoing the URL", (_label, databaseUrl) => {
    let message = "";
    try {
      describeTargetDatabase(databaseUrl);
    } catch (error) {
      expect(error).toBeInstanceOf(TeamSeedInputError);
      message = (error as Error).message;
    }
    expect(message).toBe("DATABASE_URL looks malformed (percent-encode special characters in the password)");
  });

  it("throws when DATABASE_URL is empty or unparseable", () => {
    expect(() => describeTargetDatabase(undefined)).toThrow(/DATABASE_URL is not set/);
    expect(() => describeTargetDatabase("")).toThrow(/DATABASE_URL is not set/);
    expect(() => describeTargetDatabase("not a url")).toThrow(/DATABASE_URL is not a valid URL/);
  });
});

describe("toCaseInsensitiveEmailPattern", () => {
  it("escapes ILIKE wildcards and the escape character", () => {
    expect(toCaseInsensitiveEmailPattern("jane_doe@example.com")).toBe("jane\\_doe@example.com");
    expect(toCaseInsensitiveEmailPattern("100%@example.com")).toBe("100\\%@example.com");
    expect(toCaseInsensitiveEmailPattern("a\\b@example.com")).toBe("a\\\\b@example.com");
  });

  it("leaves ordinary addresses untouched", () => {
    expect(toCaseInsensitiveEmailPattern("jane.doe+x@example.com")).toBe("jane.doe+x@example.com");
  });
});
