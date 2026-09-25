import { partitionFor } from "./maintenance.service";

describe("doc 04 §3.13 — monthly playback_events partitions", () => {
  it("names the partition after the UTC month and bounds it to [1st, next 1st)", () => {
    expect(partitionFor(new Date("2026-09-22T10:00:00Z"))).toEqual({
      name: "playback_events_2026_09",
      from: "2026-09-01",
      to: "2026-10-01",
    });
  });

  it("rolls December into the next year", () => {
    expect(partitionFor(new Date("2026-12-31T23:59:59Z"))).toEqual({
      name: "playback_events_2026_12",
      from: "2026-12-01",
      to: "2027-01-01",
    });
  });
});
