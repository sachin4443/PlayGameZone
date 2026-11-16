import { PageHead } from '../components/PageHead';
import { ErrorNote, PageLoader } from '../components/ui';
import { modeStyle } from '../lib/modes';
import type { GameMode } from '../lib/types';
import { useFetch } from '../lib/useFetch';

/** Rule sheets are generated from the live rules configuration, so they never drift from the game. */
function bullets(m: GameMode): string[] {
  const r = m.rules;
  if (m.game === 'SNAKES') {
    return [
      'Everyone starts off the board and races from square 1 to square 100.',
      'Tap the dice on your turn. The server rolls it and your piece moves by that number.',
      'Land on the foot of a ladder and you climb to its top. Land on a snake\'s head and you slide down to its tail.',
      r.extraTurnOnSix ? `A six gives you another roll${r.maxConsecutiveSixes ? `; ${r.maxConsecutiveSixes} sixes in a row end your turn` : ''}.` : 'A six gives no extra roll.',
      r.exactFinish ? 'You need the exact number to land on 100. A bigger roll does not move you.' : 'Any roll that reaches or passes 100 finishes.',
      'Pieces can share a square – nobody is captured.',
      'The first player to reach 100 wins the prize.',
    ];
  }
  const out: string[] = [];
  out.push(r.sixToRelease ? 'Tokens start in the yard. Roll a six to bring one onto your start cell.' : 'All tokens start on the board, on your start cell.');
  out.push(r.dice === 'PICK' ? 'Three dice are shared by everyone. On your turn pick one die and move a token by it; that die is then re-rolled.' : 'Tap the dice on your turn. The server rolls it – nobody can influence the result.');
  if (r.powerTurnEvery > 0) out.push(`Every ${r.powerTurnEvery}th roll is a power roll: your token moves double the number shown.`);
  out.push(`Landing on a rival token captures it and sends it back to ${r.sixToRelease ? 'the yard' : 'its start cell'}.`);
  out.push(r.starSafe ? 'Tokens on start cells and star cells are safe.' : 'Only start cells are safe – star cells give no protection.');
  out.push(r.blockSafe ? 'Two tokens of the same colour on one cell form a block that cannot be captured.' : 'Blocks give no protection: every token on the cell is captured.');
  if (r.killRequiredForHome) out.push('Your home column is locked until you capture at least one token. Until then your tokens keep circling the board.');
  out.push('You need the exact number to reach home.');
  out.push(r.dice === 'PICK' ? 'Capturing a token or reaching home gives you another turn.' : 'A six, a capture, or reaching home gives you another roll. Three sixes in a row lose the turn.');
  if (r.winBy === 'HOME') out.push(`First player to bring all ${r.tokensPerPlayer} tokens home wins the whole prize pool.`);
  else {
    out.push(`Scoring: 1 point per step, +${r.scoreKill} for a capture, +${r.scoreHome} for reaching home. A captured token loses its progress points.`);
    out.push(r.timeLimitSec ? `The game ends after ${r.timeLimitSec / 60} minutes. Highest score wins; an exact tie splits the pool.` : `Each player gets ${r.turnLimit} turns. Highest score wins; an exact tie splits the pool.`);
  }
  return out;
}

export default function RulesPage() {
  const { data, error, loading, reload } = useFetch<{ items: GameMode[] }>('/games/modes');
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (loading && !data) return <PageLoader />;
  return (
    <div>
      <PageHead title="Game rules" />
      <div className="space-y-3">
        {data!.items.map((m, i) => (
          <details key={m.key} className="card overflow-hidden" open={i === 0}>
            <summary className={`cursor-pointer list-none bg-gradient-to-r ${modeStyle(m.key).gradient} px-4 py-3 font-extrabold text-white`}>{m.name}<span className="block text-xs font-medium text-white/80">{m.tagline}</span></summary>
            <ul className="list-disc space-y-1.5 px-8 py-4 text-sm text-muted">{bullets(m).map((b) => <li key={b}>{b}</li>)}</ul>
          </details>
        ))}
        <section className="card p-4 text-sm text-muted">
          <h2 className="mb-2 font-extrabold text-ink">Timers and fair play</h2>
          <ul className="list-disc space-y-1.5 pl-4">
            <li>Each turn has a time limit. If it runs out the server plays for you; after several missed turns in a row you forfeit.</li>
            <li>If you lose connection you can rejoin and continue. Staying away too long forfeits the game.</li>
            <li>Leaving a game on purpose forfeits it and your entry.</li>
            <li>Dice, moves, captures and results are all decided on the server.</li>
          </ul>
        </section>
        <section className="card p-4 text-sm text-muted">
          <h2 className="mb-2 font-extrabold text-ink">Points</h2>
          <ul className="list-disc space-y-1.5 pl-4">
            <li>Every player's entry is locked when a game starts and the pool is paid to the winner when it ends.</li>
            <li>If a game is cancelled, every entry is refunded in full.</li>
            <li>Points are virtual: they cannot be bought, withdrawn, exchanged for cash or transferred.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
