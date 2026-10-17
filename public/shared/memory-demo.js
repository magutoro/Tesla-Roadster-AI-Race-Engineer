// Synthetic examples only. Never insert these into the live driving dataset.
const comparison = { referenceId: "example-reference-v1", trackVersion: "suzuka-example-v1", physicsVersion: "example-v1", setupId: "example-fixed-setup" };
export const MEMORY_DEMO_LAPS = [
  { source: "demo", valid: true, comparison: comparison, id: "example-lap-1", lapNumber: 1, summary: "EXAMPLE lap 1: T4 lost 0.35 s; braked 12 m early and minimum speed was 6 km/h below reference.", corners: [{ name: "T4", timeLostSeconds: 0.35, brakedEarlyMeters: 12, minimumSpeedDifferenceKmh: -6 }] },
  { source: "demo", valid: true, comparison: comparison, id: "example-lap-2", lapNumber: 2, summary: "EXAMPLE lap 2: T4 lost 0.22 s; braked 8 m early and minimum speed was 4 km/h below reference.", corners: [{ name: "T4", timeLostSeconds: 0.22, brakedEarlyMeters: 8, minimumSpeedDifferenceKmh: -4 }] },
  { source: "demo", valid: true, comparison: comparison, id: "example-lap-3", lapNumber: 3, summary: "EXAMPLE lap 3: T4 lost 0.10 s; braked 4 m early and minimum speed was 2 km/h below reference.", corners: [{ name: "T4", timeLostSeconds: 0.10, brakedEarlyMeters: 4, minimumSpeedDifferenceKmh: -2 }] },
];

export const MEMORY_DEMO_NEXT_LAP = { source: "demo", valid: true, comparison: comparison, id: "example-lap-4", lapNumber: 4,
  summary: "EXAMPLE lap 4: T4 lost 0.04 s; braked 2 m early. Same reference and conditions.",
  corners: [{ name: "T4", timeLostSeconds: 0.04, brakedEarlyMeters: 2, minimumSpeedDifferenceKmh: -1 }] };

// A separate, labeled fixture for a measured earlier-braking cue expressed in seconds.
export const LATE_BRAKING_DEMO_LAPS = MEMORY_DEMO_LAPS.map(function (lap, index) {
  return { ...lap, id: "late-braking-example-" + (index + 1),
    comparison: { ...lap.comparison, referenceId: "late-braking-example-reference" },
    summary: "EXAMPLE: T4 braking 12 m / 0.6 s later than reference; minimum speed 6 km/h lower; 0.35 s lost.",
    corners: [{ name: "T4", timeLostSeconds: 0.35, brakedEarlyMeters: -12, brakedEarlySeconds: -0.6, minimumSpeedDifferenceKmh: -6 }] };
});
