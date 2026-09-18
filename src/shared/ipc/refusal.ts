// A refusal is an answer, not a fault.
//
// Some states are ordinary: the operator picked a file this build cannot draw, an archive
// arrived damaged, a script names an include that is not there. Those are the system
// working — and the answer to them is a sentence for the operator, not a stack for the log.
// The channels that can answer this way declare it in their result union, so the regime is
// recorded where the channel is declared rather than re-decided at each call site.
//
// This is deliberately not a fault channel: a bug, or the app's own disk failing, is not
// something a caller can be told about as a value — it keeps rejecting, and only a refusal
// is converted (see the main-process marker in src/main/ipc/refusal.ts).

/** An ordinary state, as the channel answers it: no value, and the sentence to show. */
export type Refusal = {
  ok: false
  /** The text the throw carried, so the operator reads what they always read. */
  error: string
}
