// Input-only tilt detector. Rules still receive the same answer action as taps and keyboard input.
/** Create a calibrated, neutral-latched detector with a deliberate dwell before selection. */
export function createTiltDetector() {
  let base = null,
    armed = false,
    candidate = null,
    since = 0,
    last = 0;
  return {
    rearm() {
      // Preserve the comfortable center across questions; a held tilt is not a new center.
      armed = false;
      candidate = null;
    },
    reset() {
      base = null;
      armed = false;
      candidate = null;
      since = 0;
      last = 0;
    },
    sample(beta, gamma, now) {
      if (!Number.isFinite(beta) || !Number.isFinite(gamma)) {
        candidate = null;
        return null;
      }
      if (!base) {
        base = { beta, gamma };
        return null;
      }
      const x = gamma - base.gamma,
        y = ((beta - base.beta + 540) % 360) - 180;
      if (now - last > 1000) {
        candidate = null;
        since = now;
      }
      last = now;
      if (Math.abs(x) < 9 && Math.abs(y) < 9) {
        armed = true;
        candidate = null;
        return null;
      }
      if (!armed) return null;
      const direction =
        Math.abs(x) > Math.abs(y)
          ? x > 20
            ? 1
            : x < -20
              ? 0
              : null
          : y > 20
            ? 3
            : y < -20
              ? 2
              : null;
      if (direction === null) {
        candidate = null;
        return null;
      }
      if (direction !== candidate) {
        candidate = direction;
        since = now;
        return null;
      }
      if (now - since < 350) return null;
      armed = false;
      candidate = null;
      return direction;
    },
  };
}
