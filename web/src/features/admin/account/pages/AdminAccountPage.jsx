import ProfileSettingsPage from '../../../normal-user/profile/pages/ProfileSettingsPage';
import '../styles/admin-account.css';

/**
 * The administrator is also an authenticated platform user, so account-level
 * settings intentionally reuse the same profile, avatar, email, password and
 * session APIs as every other signed-in account.
 */
export default function AdminAccountPage() {
  return (
    <div className="admin-account-host">
      <ProfileSettingsPage />
    </div>
  );
}