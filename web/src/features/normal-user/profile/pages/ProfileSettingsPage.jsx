import { Camera, ImageOff, LoaderCircle, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { getStoredUser, updateStoredUser } from '../../../auth/shared/auth.storage';
import { resolveMediaUrl } from '../../../../utils/mediaUrl';
import { getMyProfile, removeProfileAvatar, uploadProfileAvatar } from '../api/profileApi';
import AvatarCropDialog from '../components/AvatarCropDialog';
import '../styles/profile-settings.css';

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SIZE = 5 * 1024 * 1024;

function getInitials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'NX';
}

export default function ProfileSettingsPage() {
  const fileInputRef = useRef(null);
  const [profile, setProfile] = useState(getStoredUser() || {});
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getMyProfile()
      .then((freshProfile) => {
        setProfile(updateStoredUser(freshProfile) || freshProfile);
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
    setSelectedFile(file);
  };

  const avatarUrl = resolveMediaUrl(profile.avatarUrl);

  return (
    <section className="profile-settings-page reveal-page">
      <header className="profile-settings-page__header">
        <span><UserRound size={16} /> Profile settings</span>
        <h1>Your Nexora identity</h1>
        <p>Choose a clear profile photo. Nexora stores only the final cropped avatar.</p>
      </header>

      <div className="profile-settings-card">
        <div className="profile-settings-card__avatar-wrap">
          <button
            type="button"
            className="profile-settings-card__avatar"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Choose a profile image"
          >
            {loading ? <LoaderCircle className="profile-settings__spin" size={30} /> : avatarUrl ? <img src={avatarUrl} alt={`${profile.fullName || 'User'} profile`} /> : <span>{getInitials(profile.fullName)}</span>}
            <i><Camera size={17} /></i>
          </button>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} hidden />
        </div>

        <div className="profile-settings-card__identity">
          <strong>{profile.fullName || 'Nexora user'}</strong>
          <span>{profile.email || 'Authenticated account'}</span>
          <small><ShieldCheck size={15} /> JPEG, PNG, or WebP · maximum 5 MB · cropped to a square</small>
        </div>

        <div className="profile-settings-card__actions">
          <button type="button" onClick={() => fileInputRef.current?.click()}><Camera size={17} /> {avatarUrl ? 'Change photo' : 'Add photo'}</button>
          {profile.avatarUrl ? (
            <button
              type="button"
              className="is-danger"
              disabled={removing}
              onClick={async () => {
                try {
                  setRemoving(true);
                  setError('');
                  const updated = await removeProfileAvatar();
                  setProfile(updateStoredUser(updated) || updated);
                } catch (requestError) {
                  setError(requestError.message);
                } finally {
                  setRemoving(false);
                }
              }}
            ><ImageOff size={17} /> {removing ? 'Removing...' : 'Remove photo'}</button>
          ) : null}
        </div>
      </div>

      {error ? <p className="profile-settings__error">{error}</p> : null}

      {selectedFile ? (
        <AvatarCropDialog
          file={selectedFile}
          onCancel={() => setSelectedFile(null)}
          onConfirm={async (croppedFile) => {
            const updated = await uploadProfileAvatar(croppedFile);
            setProfile(updateStoredUser(updated) || updated);
            setSelectedFile(null);
          }}
        />
      ) : null}
    </section>
  );
}