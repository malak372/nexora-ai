/**
 * Profile, identity, and password settings for an authenticated user.
 *
 * @author Malak
 */
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  MailCheck,
  ImageOff,
  KeyRound,
  LoaderCircle,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';

import { clearAuthSession, getStoredUser, updateStoredUser } from '../../../auth/shared/auth.storage';
import { resolveMediaUrl } from '../../../../utils/mediaUrl';
import {
  changeMyPassword,
  deleteMyAccount,
  getMyProfile,
  removeProfileAvatar,
  cancelEmailChange,
  requestEmailChange,
  updateMyProfile,
  verifyCurrentEmailChange,
  verifyNewEmailChange,
  uploadProfileAvatar,
} from '../api/profileApi';
import AvatarCropDialog from '../components/AvatarCropDialog';
import ActiveSessionsSection from '../components/ActiveSessionsSection';
import { useUserExperience } from '../../../../system/user-experience';
import NormalPageHero from '../../shared/components/NormalPageHero';
import '../styles/profile-settings.css';

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SIZE = 5 * 1024 * 1024;

function getInitials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'VO';
}


/**
 * Displays the two-step email verification flow in a document-level portal.
 * Rendering through a portal prevents transformed page containers from changing
 * the positioning of the fixed overlay.
 */
function EmailVerificationDialog({
  currentEmail,
  pendingEmail,
  stage,
  code,
  isBusy,
  shouldReduceMotion,
  onCodeChange,
  onVerify,
  onCancel,
}) {
  const { t } = useUserExperience();
  const isCurrentEmailStage = stage === 'VERIFY_CURRENT_EMAIL';

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscape = (event) => {
      if (event.key === 'Escape' && !isBusy) {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isBusy, onCancel]);

  return createPortal(
    <motion.div
      className="email-verification-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-verification-title"
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={shouldReduceMotion ? undefined : { opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.button
        type="button"
        className="email-verification-dialog__backdrop"
        aria-label={t('Close email verification')}
        disabled={isBusy}
        onClick={onCancel}
      />

      <motion.section
        className="email-verification-dialog__card"
        initial={shouldReduceMotion ? false : { opacity: 0, y: 28, scale: 0.965 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={shouldReduceMotion ? undefined : { opacity: 0, y: 18, scale: 0.98 }}
        transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="email-verification-dialog__glow" aria-hidden="true" />

        <header className="email-verification-dialog__header">
          <div className="email-verification-dialog__icon" aria-hidden="true">
            <MailCheck size={24} />
            <span />
          </div>

          <div className="email-verification-dialog__heading">
            <span>{t('Secure email change')}</span>
            <h2 id="email-verification-title">
              {t(isCurrentEmailStage ? 'Approve your request' : 'Verify your new email')}
            </h2>
            <p>
              {isCurrentEmailStage
                ? `${t('We sent a six-digit approval code to')} ${currentEmail}. ${t('Your email remains unchanged until both steps are complete.')}`
                : `${t('Your current email is approved. Enter the new code sent to')} ${pendingEmail} ${t('to finish the change.')}`}
            </p>
          </div>

          <button
            type="button"
            className="email-verification-dialog__close"
            aria-label={t('Cancel email change')}
            disabled={isBusy}
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </header>

        <div className="email-verification-dialog__steps" aria-label={t('Email verification progress')}>
          <div className="is-active">
            <i>{isCurrentEmailStage ? '1' : <CheckCircle2 size={15} />}</i>
            <span>{t('Current email')}</span>
          </div>
          <b className={isCurrentEmailStage ? '' : 'is-complete'} />
          <div className={isCurrentEmailStage ? '' : 'is-active'}>
            <i>2</i>
            <span>{t('New email')}</span>
          </div>
        </div>

        <div className="email-verification-dialog__body">
          <label htmlFor="email-verification-code">{t('Verification code')}</label>
          <div className="email-verification-dialog__code-wrap">
            <input
              id="email-verification-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              value={code}
              onChange={(event) => onCodeChange(
                event.target.value.replace(/\D/g, '').slice(0, 6),
              )}
              placeholder="000000"
              autoFocus
            />
            <span>{code.length}/6</span>
          </div>
          <small>{t('Use the newest code only. Verification codes expire for your security.')}</small>
        </div>

        <footer className="email-verification-dialog__actions">
          <button
            type="button"
            className="email-verification-dialog__secondary"
            disabled={isBusy}
            onClick={onCancel}
          >
            {t('Cancel request')}
          </button>

          <button
            type="button"
            className="email-verification-dialog__primary"
            disabled={isBusy || code.length !== 6}
            onClick={onVerify}
          >
            {isBusy ? (
              <LoaderCircle className="profile-settings__spin" size={17} />
            ) : (
              <ShieldCheck size={17} />
            )}
            {isBusy
              ? t('Verifying...')
              : t(isCurrentEmailStage ? 'Approve current email' : 'Confirm new email')}
          </button>
        </footer>
      </motion.section>
    </motion.div>,
    document.body,
  );
}

export default function ProfileSettingsPage() {
  const { t } = useUserExperience();
  const shouldReduceMotion = useReducedMotion();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [profile, setProfile] = useState(getStoredUser() || {});
  const [fullName, setFullName] = useState(getStoredUser()?.fullName || '');
  const [email, setEmail] = useState(getStoredUser()?.email || '');
  const [emailPassword, setEmailPassword] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [emailChangeStage, setEmailChangeStage] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    getMyProfile()
      .then((freshProfile) => {
        const stored = updateStoredUser(freshProfile) || freshProfile;
        setProfile(stored);
        setFullName(stored.fullName || '');
        setEmail(stored.email || '');
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

  const chooseFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!ACCEPTED_TYPES.has(file.type)) {
      setError('Choose a JPEG, PNG, or WebP image.');
      return;
    }

    if (file.size > MAX_SIZE) {
      setError('The image must be 5 MB or smaller.');
      return;
    }

    setError('');
    setNotice('');
    setSelectedFile(file);
  };

  const avatarUrl = resolveMediaUrl(profile.avatarUrl);

  return (
    <motion.section
      className="profile-settings-page reveal-page"
      data-no-auto-translate="true"
      initial={shouldReduceMotion ? undefined : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
    >
      <NormalPageHero
        variant="profile"
        eyebrow={t('Profile settings')}
        title={t('Your Voxidence identity, secure and personal.')}
        description={t('Manage your photo, display name, email access, password, and active sessions from one protected account space.')}
        chips={[t('Personal identity'), t('Account security'), t('Session control')]}
        compact
      />

      <motion.div
        className="profile-settings-card"
        initial={shouldReduceMotion ? undefined : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.25 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="profile-settings-card__avatar-wrap">
          <button
            type="button"
            className="profile-settings-card__avatar"
            onClick={() => fileInputRef.current?.click()}
            aria-label={t('Choose a profile image')}
          >
            {loading ? (
              <LoaderCircle className="profile-settings__spin" size={30} />
            ) : avatarUrl ? (
              <img src={avatarUrl} alt={`${profile.fullName || 'User'} profile`} />
            ) : (
              <span>{getInitials(profile.fullName)}</span>
            )}
            <i><Camera size={17} /></i>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={chooseFile}
            hidden
          />
        </div>

        <div className="profile-settings-card__identity">
          <strong dir="auto" data-no-auto-translate="true">{profile.fullName || t('Voxidence user')}</strong>
          <span dir="ltr" data-no-auto-translate="true">{profile.email || t('Authenticated account')}</span>
          <small><ShieldCheck size={15} /> {t('JPEG, PNG, or WebP · maximum 5 MB · cropped to a square')}</small>
        </div>

        <div className="profile-settings-card__actions">
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            <Camera size={17} /> {t(avatarUrl ? 'Change photo' : 'Add photo')}
          </button>
          {profile.avatarUrl ? (
            <button
              type="button"
              className="is-danger"
              disabled={removing}
              onClick={async () => {
                try {
                  setRemoving(true);
                  setError('');
                  setNotice('');
                  const updated = await removeProfileAvatar();
                  setProfile(updateStoredUser(updated) || updated);
                  setNotice('Profile photo removed.');
                } catch (requestError) {
                  setError(requestError.message);
                } finally {
                  setRemoving(false);
                }
              }}
            >
              <ImageOff size={17} /> {t(removing ? 'Removing...' : 'Remove photo')}
            </button>
          ) : null}
        </div>
      </motion.div>

      <motion.div
        className="profile-settings-grid"
        initial={shouldReduceMotion ? undefined : { opacity: 0, y: 26 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.14 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <form
          className="profile-settings-panel"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              setSavingProfile(true);
              setError('');
              setNotice('');
              const emailChanged = email.trim().toLowerCase() !== String(profile.email || '').toLowerCase();
              const updated = await updateMyProfile({
                fullName: fullName.trim(),
              });
              const stored = updateStoredUser(updated) || updated;
              setProfile(stored);

              if (emailChanged) {
                const requestResult = await requestEmailChange({
                  newEmail: email.trim().toLowerCase(),
                  currentPassword: emailPassword,
                });
                setPendingEmail(requestResult.newEmail || email.trim().toLowerCase());
                setEmailChangeStage('VERIFY_CURRENT_EMAIL');
                setVerificationCode('');
                setEmailPassword('');
                setNotice('A 6-digit approval code was sent to your current email address.');
              } else {
                setNotice('Profile information updated.');
              }
            } catch (requestError) {
              setError(requestError.message);
            } finally {
              setSavingProfile(false);
            }
          }}
        >
          <div className="profile-settings-panel__title">
            <UserRound size={20} />
            <div><strong>{t('Personal information')}</strong><span>{t('Update your display name and sign-in email securely.')}</span></div>
          </div>
          <label>
            {t('Full name')}
            <input
              value={fullName}
              minLength={2}
              maxLength={120}
              onChange={(event) => setFullName(event.target.value)}
              required
            />
          </label>
          <label>
            {t('Email')}
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <small>{t('Changing your email requires your current password.')}</small>
          </label>
          {email.trim().toLowerCase() !== String(profile.email || '').toLowerCase() ? (
            <label>
              {t('Confirm current password')}
              <input type="password" autoComplete="current-password" value={emailPassword} onChange={(event) => setEmailPassword(event.target.value)} required />
            </label>
          ) : null}
          <button type="submit" disabled={savingProfile || fullName.trim().length < 2}>
            {savingProfile ? <LoaderCircle className="profile-settings__spin" size={17} /> : <Save size={17} />}
            {t(savingProfile ? 'Saving...' : 'Save profile')}
          </button>

          <AnimatePresence>
            {pendingEmail ? (
              <EmailVerificationDialog
                currentEmail={profile.email || ''}
                pendingEmail={pendingEmail}
                stage={emailChangeStage}
                code={verificationCode}
                isBusy={verifyingEmail}
                shouldReduceMotion={shouldReduceMotion}
                onCodeChange={setVerificationCode}
                onVerify={async () => {
                  try {
                    setVerifyingEmail(true);
                    setError('');
                    setNotice('');

                    if (emailChangeStage === 'VERIFY_CURRENT_EMAIL') {
                      const result = await verifyCurrentEmailChange(verificationCode);
                      setEmailChangeStage(result.stage || 'VERIFY_NEW_EMAIL');
                      setVerificationCode('');
                      setNotice('Current email approved. A new code was sent to the new email address.');
                      return;
                    }

                    const result = await verifyNewEmailChange(verificationCode);
                    const storedProfile = updateStoredUser(result.profile) || result.profile;
                    setProfile(storedProfile);
                    setEmail(storedProfile.email || pendingEmail);
                    setPendingEmail('');
                    setEmailChangeStage('');
                    setVerificationCode('');
                    setNotice('Email changed successfully. A security notice was sent to your old email.');
                  } catch (requestError) {
                    setError(requestError.message);
                  } finally {
                    setVerifyingEmail(false);
                  }
                }}
                onCancel={async () => {
                  try {
                    setVerifyingEmail(true);
                    setError('');
                    await cancelEmailChange();
                    setPendingEmail('');
                    setEmailChangeStage('');
                    setVerificationCode('');
                    setEmail(profile.email || '');
                    setNotice('Email-change request cancelled.');
                  } catch (requestError) {
                    setError(requestError.message);
                  } finally {
                    setVerifyingEmail(false);
                  }
                }}
              />
            ) : null}
          </AnimatePresence>
        </form>

        <form
          className="profile-settings-panel"
          onSubmit={async (event) => {
            event.preventDefault();
            if (passwords.newPassword !== passwords.confirmPassword) {
              setError('New password confirmation does not match.');
              return;
            }

            try {
              setSavingPassword(true);
              setError('');
              setNotice('');
              await changeMyPassword({
                currentPassword: passwords.currentPassword,
                newPassword: passwords.newPassword,
              });
              setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
              setNotice('Password changed successfully.');
            } catch (requestError) {
              setError(requestError.message);
            } finally {
              setSavingPassword(false);
            }
          }}
        >
          <div className="profile-settings-panel__title">
            <KeyRound size={20} />
            <div><strong>{t('Security')}</strong><span>{t('Use at least one letter and one number.')}</span></div>
          </div>
          <label>
            {t('Current password')}
            <input
              type="password"
              autoComplete="current-password"
              value={passwords.currentPassword}
              onChange={(event) => setPasswords((current) => ({ ...current, currentPassword: event.target.value }))}
              required
            />
          </label>
          <label>
            {t('New password')}
            <input
              type="password"
              autoComplete="new-password"
              minLength={6}
              value={passwords.newPassword}
              onChange={(event) => setPasswords((current) => ({ ...current, newPassword: event.target.value }))}
              required
            />
          </label>
          <label>
            {t('Confirm new password')}
            <input
              type="password"
              autoComplete="new-password"
              minLength={6}
              value={passwords.confirmPassword}
              onChange={(event) => setPasswords((current) => ({ ...current, confirmPassword: event.target.value }))}
              required
            />
          </label>
          <button type="submit" disabled={savingPassword}>
            {savingPassword ? <LoaderCircle className="profile-settings__spin" size={17} /> : <ShieldCheck size={17} />}
            {t(savingPassword ? 'Changing...' : 'Change password')}
          </button>
        </form>
      </motion.div>





      <motion.div
        initial={shouldReduceMotion ? undefined : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.16 }}
        transition={{ duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
      >
        <ActiveSessionsSection
          onSignedOutEverywhere={() => {
            clearAuthSession();
            navigate('/login', {
              replace: true,
              state: { sessionsRevoked: true },
            });
          }}
        />
      </motion.div>

      <motion.section
        className="profile-settings-danger"
        initial={shouldReduceMotion ? undefined : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="profile-settings-danger__icon"><Trash2 size={22} /></div>
        <div className="profile-settings-danger__copy">
          <span>{t('Danger zone')}</span>
          <h2>{t('Delete your Voxidence account')}</h2>
          <p>
            {t('This closes your account, signs you out everywhere, and removes your personal profile information. Existing project records are preserved anonymously for data integrity.')}
          </p>
        </div>
        <button type="button" onClick={() => { setError(''); setDeleteDialogOpen(true); }}>
          <Trash2 size={17} /> {t('Delete account')}
        </button>
      </motion.section>

      {notice ? <p className="profile-settings__notice"><CheckCircle2 size={17} /> {t(notice)}</p> : null}
      {error ? <p className="profile-settings__error">{t(error)}</p> : null}



      {deleteDialogOpen ? createPortal(
        <motion.div
          className="delete-account-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            className="delete-account-dialog__backdrop"
            aria-label={t('Close delete account dialog')}
            onClick={() => !deletingAccount && setDeleteDialogOpen(false)}
          />
          <motion.form
            className="delete-account-dialog__card"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 28, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                setDeletingAccount(true);
                setError('');
                await deleteMyAccount(deletePassword);
                clearAuthSession();
                navigate('/login', { replace: true, state: { accountDeleted: true } });
              } catch (requestError) {
                setError(requestError.message);
              } finally {
                setDeletingAccount(false);
              }
            }}
          >
            <button
              type="button"
              className="delete-account-dialog__close"
              aria-label={t('Close')}
              disabled={deletingAccount}
              onClick={() => setDeleteDialogOpen(false)}
            ><X size={18} /></button>
            <div className="delete-account-dialog__icon"><AlertTriangle size={26} /></div>
            <span>{t('Final confirmation')}</span>
            <h2 id="delete-account-title">{t('Delete your account?')}</h2>
            <p>{t('This action cannot be undone. Enter your current password to confirm.')}</p>
            <label>
              {t('Current password')}
              <input
                type="password"
                autoComplete="current-password"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
                placeholder={t('Enter your current password')}
                minLength={6}
                required
                autoFocus
              />
            </label>
            {error ? <p className="delete-account-dialog__error">{t(error)}</p> : null}
            <div className="delete-account-dialog__actions">
              <button type="button" disabled={deletingAccount} onClick={() => setDeleteDialogOpen(false)}>
                {t('Keep my account')}
              </button>
              <button type="submit" className="is-danger" disabled={deletingAccount || deletePassword.length < 6}>
                {deletingAccount ? <LoaderCircle className="profile-settings__spin" size={17} /> : <Trash2 size={17} />}
                {t(deletingAccount ? 'Deleting...' : 'Delete permanently')}
              </button>
            </div>
          </motion.form>
        </motion.div>,
        document.body,
      ) : null}

      {selectedFile ? (
        <AvatarCropDialog
          file={selectedFile}
          onCancel={() => setSelectedFile(null)}
          onConfirm={async (croppedFile) => {
            const updated = await uploadProfileAvatar(croppedFile);
            setProfile(updateStoredUser(updated) || updated);
            setSelectedFile(null);
            setNotice('Profile photo updated.');
          }}
        />
      ) : null}
    </motion.section>
  );
}