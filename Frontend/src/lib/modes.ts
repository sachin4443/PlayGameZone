/** Presentation for each rules preset (the rules themselves come from the server). */
export const MODE_STYLE: Record<string, { gradient: string; badge: string; art: 'board' | 'clock' | 'burst' | 'dice' | 'lock' }> = {
  CLASSIC: { gradient: 'from-emerald-500 to-teal-700', badge: 'Classic', art: 'board' },
  SCORE: { gradient: 'from-blue-500 to-indigo-800', badge: 'Score attack', art: 'clock' },
  MANIA: { gradient: 'from-orange-500 to-rose-700', badge: 'Chaos', art: 'burst' },
  PICK_DICE: { gradient: 'from-fuchsia-500 to-purple-800', badge: 'Strategy', art: 'dice' },
  KILL_TO_ENTER: { gradient: 'from-slate-600 to-slate-900', badge: 'Hardcore', art: 'lock' },
};
export const modeStyle = (key: string) => MODE_STYLE[key] ?? MODE_STYLE.CLASSIC;
