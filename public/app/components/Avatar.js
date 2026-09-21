// A player's emoji in a circle. It is always next to the player's name, so it is marked
// aria-hidden: a screen reader that announced "fox, Wesley" would be reading decoration.

import { html } from '../h.js';

/**
 * @param {{
 *   player?: import('../../../types/parlor.js').PlayerInfo | null,
 *   avatar?: string,
 *   size?: 'sm' | 'md' | 'lg' | 'xl',
 *   away?: boolean,
 *   winner?: boolean,
 * }} props
 */
export function Avatar({ player, avatar, size = 'md', away, winner }) {
  const emoji = avatar || (player && player.avatar) || '🙂';
  // A player who is not connected is dimmed, unless the caller has already said otherwise.
  const isAway = away === undefined ? !!(player && player.connected === false) : away;
  const classes = ['avatar'];
  if (size !== 'md') classes.push(`avatar-${size}`);
  if (winner) classes.push('avatar-winner');
  if (isAway) classes.push('is-away');
  return html`<span class=${classes.join(' ')} aria-hidden="true">${emoji}</span>`;
}
