/**
 * Authenticated Nexora workspace shell.
 *
 * Desktop navigation lives in a floating top command bar instead of a
 * permanent left sidebar. A compact drawer is used only on smaller screens.
 */
import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { getAccessToken } from '../../features/auth/shared/auth.storage';
import NormalHeader from './NormalHeader';
import PremiumWelcomeCelebration from '../../features/normal-user/shared/components/PremiumWelcomeCelebration';
import NormalSidebar from './NormalSidebar';
import './normal-user-layout.css';
import './normal-user-theme.css';
import { preloadPrimaryRoutes } from '../../routes/routePreloaders';

export default function NormalUserLayout() {
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (!getAccessToken()) navigate('/login', { replace: true });
  }, [navigate]);

  useEffect(() => {
    preloadPrimaryRoutes();
  }, []);

  useEffect(() => {
    const handleExpired = () => navigate('/login', { replace: true });
    window.addEventListener('nexora:session-expired', handleExpired);
    return () => window.removeEventListener('nexora:session-expired', handleExpired);
  }, [navigate]);

  return (
    <div className="normal-app-shell">
      <PremiumWelcomeCelebration />
      <div className="normal-app-shell__aurora" aria-hidden="true" />
      <NormalHeader onOpenMenu={() => setIsMenuOpen(true)} />
      <NormalSidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />
      <main className="normal-app-shell__main"><Outlet /></main>
    </div>
  );
}