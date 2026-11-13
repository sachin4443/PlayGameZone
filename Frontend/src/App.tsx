import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PageLoader } from './components/ui';
import GamePage from './pages/Game';
import HelpPage from './pages/Help';
import HomePage from './pages/Home';
import LeaderboardPage from './pages/Leaderboard';
import LivePage from './pages/Live';
import LoginPage from './pages/Login';
import NotificationsPage from './pages/Notifications';
import ProfilePage from './pages/Profile';
import ReferPage from './pages/Refer';
import RoomPage from './pages/Room';
import RulesPage from './pages/Rules';
import TournamentDetailPage from './pages/TournamentDetail';
import TournamentsPage from './pages/Tournaments';
import WalletPage from './pages/Wallet';
import { useAuth } from './state/auth';

// The admin panel is a separate bundle: players never download it.
const AdminApp = lazy(() => import('./admin/AdminApp'));

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/admin/*" element={<Suspense fallback={<PageLoader />}><AdminApp /></Suspense>} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/game/:id" element={<GamePage />} />
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="/room/:code" element={<RoomPage />} />
          <Route path="/live" element={<LivePage />} />
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/refer" element={<ReferPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
