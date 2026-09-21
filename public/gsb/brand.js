// The game's name lives in one place: the <title> and og:title in public/gsb/index.html. Change it there and every
// share sheet, link preview and heading follows. "Classmates" stays the short name for buttons and copy.
export const GAME_NAME = (typeof document !== "undefined" && document.querySelector('meta[property="og:title"]')?.getAttribute("content")) || "Classmates";
export const SHORT_NAME = "Classmates";
