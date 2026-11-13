import { Link } from 'react-router-dom';
import { PageHead } from '../components/PageHead';

const FAQ: [string, string][] = [
  ['How do I get points?', 'Every new player receives a one-time welcome bonus. After that you earn points by winning games and tournaments, and by inviting friends.'],
  ['Can I buy or withdraw points?', 'No. Points are virtual gaming credits with no cash value. They cannot be purchased, withdrawn or transferred to another player.'],
  ['How do private rooms work?', 'Tap "Create room", choose a mode, the number of players and the entry. Share the six-character room code; friends enter it under "Join by code". The host starts the game once everyone is ready.'],
  ['When are my entry points taken?', 'Only when the game actually starts. They are held safely until the game ends, then the whole pool goes to the winner. If the game is cancelled you get them back.'],
  ['I lost my connection mid-game. What now?', 'Reopen the app – the home screen shows a "Rejoin" banner and you continue exactly where the game is. While you are away the server plays your turns; if you stay away too long you forfeit.'],
  ['No opponent was found in Quick match.', 'The search stops after a short while if nobody else is queueing for the same mode, table size and entry. Nothing is deducted. Try a popular entry such as 20, or create a room and share the code.'],
  ['Is the dice fair?', 'Yes. Every roll is generated on the server with a cryptographically secure random source. The app only displays the result.'],
  ['A tournament match started without me.', 'Tournament matches begin automatically at the scheduled time and the turn timer runs. Register only for cups you can attend.'],
];

export default function HelpPage() {
  return (
    <div>
      <PageHead title="Help & support" />
      <div className="space-y-2">
        {FAQ.map(([q, a]) => (
          <details key={q} className="card p-4">
            <summary className="cursor-pointer text-sm font-bold">{q}</summary>
            <p className="mt-2 text-sm text-muted">{a}</p>
          </details>
        ))}
      </div>
      <p className="mt-5 text-center text-sm text-muted">Looking for how a mode plays? See the <Link to="/rules" className="font-bold text-brand underline">game rules</Link>.</p>
    </div>
  );
}
