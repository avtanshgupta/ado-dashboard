/**
 * Per-user SSE client registry (A2).
 *
 * Previously every open SSE connection ran its OWN 60s poll loop, and each poll
 * re-enriches all of a user's tracked lists — so N tabs/devices for one user cost
 * N× the Azure DevOps load. This registry lets the stream service keep a SINGLE
 * poll loop per user and fan each result out to all of that user's connected
 * clients. It is deliberately pure bookkeeping (no timers, no Express) so it can
 * be unit-tested; the stream service owns the actual interval + fan-out.
 */
export class PollRegistry {
  constructor() {
    this.users = new Map(); // userId -> Set<client>
  }

  /** Register a client. Returns { isFirst, size } — isFirst means "start the loop". */
  add(userId, client) {
    let set = this.users.get(userId);
    const isFirst = !set;
    if (!set) {
      set = new Set();
      this.users.set(userId, set);
    }
    set.add(client);
    return { isFirst, size: set.size };
  }

  /** Deregister a client. Returns { isEmpty, size } — isEmpty means "stop the loop". */
  remove(userId, client) {
    const set = this.users.get(userId);
    if (!set) return { isEmpty: true, size: 0 };
    set.delete(client);
    const isEmpty = set.size === 0;
    if (isEmpty) this.users.delete(userId);
    return { isEmpty, size: set.size };
  }

  /** Snapshot of a user's currently-connected clients. */
  clients(userId) {
    return [...(this.users.get(userId) || [])];
  }

  /** How many clients a user currently has connected. */
  size(userId) {
    return this.users.get(userId)?.size || 0;
  }

  /** Number of users with at least one connected client. */
  userCount() {
    return this.users.size;
  }
}
