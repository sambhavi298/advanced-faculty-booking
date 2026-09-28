/**
 * A barrier for concurrency tests: `arrive()` resolves only once `parties` callers have arrived,
 * so N concurrent operations can be lined up to hit the database at the same moment.
 */
export function barrier(parties: number): { arrive: () => Promise<void> } {
  let arrived = 0;
  let release!: () => void;
  const allArrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    arrive: () => {
      arrived += 1;
      if (arrived === parties) {
        release();
      }
      return allArrived;
    },
  };
}
