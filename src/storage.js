/* Saved games, kept in this browser's localStorage. Best effort: storage can be
   unavailable (private mode), in which case games simply are not remembered. */
const key = (room, role) => 'varchess:' + room + ':' + role;

export function saveGame(room, role, data) {
  try { localStorage.setItem(key(room, role), JSON.stringify(data)); } catch (e) { /* not available */ }
}

export function loadGame(room, role) {
  try { return JSON.parse(localStorage.getItem(key(room, role))); } catch (e) { return null; }
}
