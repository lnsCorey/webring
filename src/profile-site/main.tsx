import React from 'react';
import ReactDOM from 'react-dom/client';
import { ProfileSiteApp } from './ProfileSiteApp';
import '../index.css';

ReactDOM.createRoot(document.getElementById('profile-app-root')!).render(
  <React.StrictMode>
    <ProfileSiteApp />
  </React.StrictMode>
);

