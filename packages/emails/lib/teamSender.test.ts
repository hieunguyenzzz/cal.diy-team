import { describe, expect, it, vi } from "vitest";
import { applyTeamSender, parseTeamSenderMap } from "./teamSender";

const FROM = "SoundBox Store <noreply@soundboxstore.com>";
const QUELL = '{"3":{"address":"bookings@quellworkspaces.com","name":"Quell Workspaces"}}';

describe("parseTeamSenderMap", () => {
  it("returns an empty map when unset", () => {
    expect(parseTeamSenderMap(undefined)).toEqual({});
    expect(parseTeamSenderMap("")).toEqual({});
  });

  it("ignores invalid JSON without throwing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => parseTeamSenderMap("{not json")).not.toThrow();
    expect(parseTeamSenderMap("{not json")).toEqual({});
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("drops bad entries but keeps valid ones", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const map = parseTeamSenderMap(
      '{"3":{"name":"Quell Workspaces"},"4":{"address":"not-an-email"},"5":"nope"}'
    );
    expect(map).toEqual({ "3": { name: "Quell Workspaces" } });
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("rejects non-object JSON", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(parseTeamSenderMap("[1,2]")).toEqual({});
    expect(parseTeamSenderMap("null")).toEqual({});
    spy.mockRestore();
  });
});

describe("applyTeamSender", () => {
  const map = parseTeamSenderMap(QUELL);

  it("leaves from unchanged when the var is unset", () => {
    expect(applyTeamSender(FROM, 3, parseTeamSenderMap(undefined))).toBeNull();
  });

  it("leaves from unchanged when there is no team", () => {
    expect(applyTeamSender(FROM, undefined, map)).toBeNull();
  });

  it("replaces name and address for a mapped team", () => {
    expect(applyTeamSender(FROM, 3, map)).toBe("Quell Workspaces <bookings@quellworkspaces.com>");
  });

  it("leaves an unmapped team unchanged", () => {
    expect(applyTeamSender(FROM, 2, map)).toBeNull();
  });

  it("leaves from unchanged when the JSON is invalid", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(applyTeamSender(FROM, 3, parseTeamSenderMap("{bad"))).toBeNull();
    spy.mockRestore();
  });

  it("overrides only the name for a name-only entry", () => {
    const nameOnly = parseTeamSenderMap('{"3":{"name":"Quell Workspaces"}}');
    expect(applyTeamSender(FROM, 3, nameOnly)).toBe("Quell Workspaces <noreply@soundboxstore.com>");
  });

  it("overrides only the address for an address-only entry", () => {
    const addressOnly = parseTeamSenderMap('{"3":{"address":"bookings@quellworkspaces.com"}}');
    expect(applyTeamSender(FROM, 3, addressOnly)).toBe("SoundBox Store <bookings@quellworkspaces.com>");
  });

  it("handles a bare-address from", () => {
    expect(applyTeamSender("noreply@soundboxstore.com", 3, map)).toBe(
      "Quell Workspaces <bookings@quellworkspaces.com>"
    );
    const addressOnly = parseTeamSenderMap('{"3":{"address":"bookings@quellworkspaces.com"}}');
    expect(applyTeamSender("noreply@soundboxstore.com", 3, addressOnly)).toBe("bookings@quellworkspaces.com");
  });
});
