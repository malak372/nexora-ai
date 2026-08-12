/**
 * Authenticated Voxidence workspace shell optimized for fast route transitions
 * and reliable responsive navigation.
 *
 * @author Eman
 */
import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';

import { getAccessToken } from '../../features/auth/shared/auth.storage';
import PremiumWelcomeCelebration from '../../features/normal-user/shared/components/PremiumWelcomeCelebration';
import { preloadPrimaryRoutes } from '../../routes/routePreloaders';
import NormalHeader from './NormalHeader';
import NormalSidebar from './NormalSidebar';
import './normal-user-layout.css';
import './normal-user-theme.css';

export default function NormalUserLayout() {
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (!getAccessToken()) navigate('/login', { replace: true });
  }, [navigate]);

  useEffect(() => {
    const handleExpired = () => navigate('/login', { replace: true });
    window.addEventListener('nexora:session-expired', handleExpired);
    return () => window.removeEventListener('nexora:session-expired', handleExpired);
  }, [navigate]);

  useEffect(() => preloadPrimaryRoutes(), []);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setIsMenuOpen(false);
    };

    const closeWhenReturningToDesktop = () => {
      if (window.innerWidth > 1180) setIsMenuOpen(false);
    };

    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeWhenReturningToDesktop);

    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeWhenReturningToDesktop);
    };
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMenuOpen]);

  return (
    <div className="normal-app-shell">
      <PremiumWelcomeCelebration />
      <div className="normal-app-shell__aurora" aria-hidden="true" />

      <NormalHeader
        isMenuOpen={isMenuOpen}
        onOpenMenu={() => setIsMenuOpen((open) => !open)}
      />

      <NormalSidebar
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
      />

      <main className="normal-app-shell__main">
        <Outlet />
      </main>
    </div>
  );
}