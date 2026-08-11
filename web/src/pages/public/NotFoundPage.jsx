/**
 * Friendly fallback page for unknown application routes.
 *
 * This component must always provide a valid default export because it is
 * loaded through React.lazy() in AppRoutes.
 *
 * @author Eman
 */
import { ArrowLeft, Home, MapPinOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import VoxidenceMark from '../../components/brand/VoxidenceMark';
import './styles/not-found-page.css';

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <main className="vox-not-found">
      <section className="vox-not-found__card" aria-labelledby="not-found-title">
        <div className="vox-not-found__brand">
          <VoxidenceMark size={48} />
          <div>
            <strong>Voxidence</strong>
            <span>Page navigation</span>
          </div>
        </div>

        <div className="vox-not-found__icon" aria-hidden="true">
          <MapPinOff size={28} strokeWidth={1.8} />
        </div>

        <span className="vox-not-found__eyebrow">404 · PAGE NOT FOUND</span>
        <h1 id="not-found-title">This page does not exist.</h1>
        <p>
          The address may be outdated, incomplete, or no longer available.
          You can return to the previous page or continue to the Voxidence home page.
        </p>

        <div className="vox-not-found__actions">
          <button
            type="button"
            className="vox-not-found__button vox-not-found__button--secondary"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft size={16} />
            Go back
          </button>

          <button
            type="button"
            className="vox-not-found__button vox-not-found__button--primary"
            onClick={() => navigate('/', { replace: true })}
          >
            <Home size={16} />
            Go to home
          </button>
        </div>
      </section>
    </main>
  );
}