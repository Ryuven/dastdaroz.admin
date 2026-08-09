/**
 * firebase.js — единая инициализация Firebase
 * Используется в: admin-login.html, app.js
 *
 * TODO (при переходе на api.dastdaroz.shop):
 *   - auth оставить для верификации токенов
 *   - db убрать, заменить на fetch() к своему API
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js';
import { getAuth }       from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js';
import { getFirestore }  from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            'AIzaSyCjIAMFuwLKwmjChCuiz-MHLv5WZOczAAE',
  authDomain:        'delivery-galelium.firebaseapp.com',
  projectId:         'delivery-galelium',
  storageBucket:     'delivery-galelium.firebasestorage.app',
  messagingSenderId: '982466555080',
  appId:             '1:982466555080:web:c77ccbff0e71e540ddc9fd',
};

const firebaseApp = initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
export const db   = getFirestore(firebaseApp);
