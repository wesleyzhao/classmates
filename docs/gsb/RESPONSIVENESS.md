# Classmates responsiveness

Practice keeps the incoming shuffled order among cards with equal review priority and due time. Due dates still sort earlier reviews first. This restores variation across new-card sessions without changing the spaced-review schedule.

Prefetched private portraits can render from an already resolved object URL on the first paint. Photo loading starts in a layout effect, and retries invalidate a failed object URL before making the same-origin no-store request again. Mounted photos retain their object URLs until unmount, so preloading upcoming questions cannot evict a visible or in-flight photo. The cache remains session-only and bounded to twelve images; preload requests stop at that bound so excess speculative requests do not evict each other while in flight.

Tap, keyboard, and tilt share an input latch keyed by question and answer state. It blocks duplicate submissions before Preact renders a disabled button, then permits another race attempt once the wrong-choice state advances. A failed room action releases the latch. Number keys still work after an answer button receives focus; text-entry and unrelated controls retain their own keyboard behavior.

Room answers receive an immediate selected outline while the server resolves correctness. Failure clears the selection for retry; the next race question and shared reveal remain authoritative. Ready and reveal deadlines trigger a refresh through the same polling loop, which coalesces overlapping requests rather than opening duplicate polls. Race cooldown enables input from the local server-anchored clock without another request.

ClassRooms authenticates membership against the room document already read for a snapshot/action, including every CAS retry. Removing the router's duplicate room lookup saves one database round trip for each poll and action without caching an authorization decision. Leaderboard ratings and personal-best queries run concurrently.
