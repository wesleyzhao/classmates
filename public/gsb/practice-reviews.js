// Practice-only save queue: retain unsaved reviews through reload without blocking the next card.
/** @typedef {{id:string,personId:string,direction:string,correct:boolean,questionId?:string,choice?:string,saving?:boolean,error?:boolean}} Review */

/**
 * Keep ordered, account-scoped retries in this tab. Only opaque IDs and correctness are stored.
 * @param {string} accountId
 * @param {{storage?: Pick<Storage, 'getItem'|'setItem'|'removeItem'>, send: (review: Review) => Promise<any>, onChange?: (event: any) => void}} options
 */
export function createPracticeReviews(accountId, { storage, send, onChange = () => {} }) {
  const key = `gsb-practice-pending:${accountId}`;
  /** @type {Map<string, Review>} */
  const pending = new Map();
  let active = true, flight = null;
  try {
    const restored = JSON.parse(storage?.getItem(key) || "[]");
    if (Array.isArray(restored)) for (const item of restored) {
      if (typeof item?.id !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(item.id) ||
          typeof item.personId !== "string" || !item.personId ||
          !["face", "name"].includes(item.direction) || typeof item.correct !== "boolean") continue;
      pending.set(item.id, {
        id: item.id, personId: item.personId, direction: item.direction,
        correct: item.correct, saving: false, error: false,
      });
    }
  } catch { /* Storage may be unavailable; reviews can still save normally. */ }
  const remember = () => {
    try {
      if (pending.size) storage?.setItem(key, JSON.stringify([...pending.values()].map(
        ({ id, personId, direction, correct }) => ({ id, personId, direction, correct }),
      )));
      else storage?.removeItem(key);
    } catch { /* A denied/quota-limited store must not interrupt practice. */ }
  };
  const drain = async () => {
    // Sequential writes preserve the order of a wrong answer followed by a correct retry.
    while (active && pending.size) {
      const review = pending.values().next().value;
      review.saving = true;
      review.error = false;
      onChange({ review });
      try {
        const result = await send(review);
        if (!active) return;
        pending.delete(review.id);
        remember();
        onChange({ review, result });
      } catch (error) {
        if (!active) return;
        review.saving = false;
        review.error = true;
        // A live opt-out must not prevent other classmates' reviews from saving.
        const discarded = error.status === 404 || error.status === 400;
        if (discarded) { pending.delete(review.id); remember(); }
        onChange({ review, error, discarded });
        if (!discarded) return;
      }
    }
  };
  const retry = () => {
    if (!active || !pending.size) return Promise.resolve();
    if (!flight) flight = drain().finally(() => { flight = null; });
    return flight;
  };
  return {
    pending,
    /** @param {Review} review */
    add(review) {
      if (!active || pending.has(review.id)) return;
      pending.set(review.id, review);
      remember(); // Persist before sending; the response may be lost after the server commits.
      void retry();
    },
    retry,
    suspend() {
      active = false;
      pending.clear(); // Keep storage for the same account's next verified sign-in.
    },
  };
}

/**
 * Merge server progress without letting an older fetch overwrite a more recent saved review.
 * @param {Record<string, any>} current
 * @param {Record<string, any>} incoming
 * @returns {Record<string, any>}
 */
export function mergePracticeProgress(current, incoming) {
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (!merged[key] || value.reviews >= merged[key].reviews) merged[key] = value;
  }
  return merged;
}
