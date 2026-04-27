import {
  ApplicationConfig,
  LOCALE_ID,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeJa from '@angular/common/locales/ja';
import { provideRouter } from '@angular/router';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getStorage, provideStorage } from '@angular/fire/storage';
import {getFunctions, provideFunctions } from '@angular/fire/functions';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { routes } from './app.routes';
registerLocaleData(localeJa);

const firebaseConfig = {
  apiKey: 'AIzaSyBsruStESBadPYdfJuZCwD9EVLtbpk0v6c',
  authDomain: 'kensyu10149.firebaseapp.com',
  databaseURL: 'https://kensyu10149-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'kensyu10149',
  storageBucket: 'kensyu10149.firebasestorage.app',
  messagingSenderId: '974685599827',
  appId: '1:974685599827:web:78591b354f6bf8ba42aea6',
  measurementId: 'G-KFEF841K0T',
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideAnimationsAsync(),
    { provide: LOCALE_ID, useValue: 'ja' },
    provideNativeDateAdapter(),
    { provide: MAT_DATE_LOCALE, useValue: 'ja-JP' },
    provideFirebaseApp(() => initializeApp(firebaseConfig)),
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
    provideStorage(() => getStorage()),
    provideFunctions(() => getFunctions(undefined, 'asia-northeast1')),
  ],
};
