import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { en_US, provideNzI18n } from 'ng-zorro-antd/i18n';
import { registerLocaleData } from '@angular/common';
import en from '@angular/common/locales/en';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient } from '@angular/common/http';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getAnalytics, provideAnalytics, ScreenTrackingService, UserTrackingService } from '@angular/fire/analytics';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, provideAppCheck } from '@angular/fire/app-check';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getDatabase, provideDatabase } from '@angular/fire/database';
import { getDataConnect, provideDataConnect } from '@angular/fire/data-connect';
import { getFunctions, provideFunctions } from '@angular/fire/functions';
import { getMessaging, provideMessaging } from '@angular/fire/messaging';
import { getPerformance, providePerformance } from '@angular/fire/performance';
import { getStorage, provideStorage } from '@angular/fire/storage';
import { getRemoteConfig, provideRemoteConfig } from '@angular/fire/remote-config';
import { getVertexAI, provideVertexAI } from '@angular/fire/vertexai';


registerLocaleData(en);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes), 
    provideNzI18n(en_US), 
    provideAnimationsAsync(), 
    provideHttpClient(), 
    provideFirebaseApp(() => initializeApp({ 
      projectId: "kensyu10149", 
      appId: "1:974685599827:web:78591b354f6bf8ba42aea6", 
      databaseURL: "https://kensyu10149-default-rtdb.asia-southeast1.firebasedatabase.app", 
      storageBucket: "kensyu10149.firebasestorage.app", 
      apiKey: "AIzaSyBsruStESBadPYdfJuZCwD9EVLtbpk0v6c", 
      authDomain: "kensyu10149.firebaseapp.com", 
      messagingSenderId: "974685599827", 
      measurementId: "G-KFEF841K0T", 
    })), 
    provideAuth(() => getAuth()), 
    provideAnalytics(() => getAnalytics()), 
    ScreenTrackingService, 
    UserTrackingService,
    provideAppCheck(() => {
  // TODO get a reCAPTCHA Enterprise here https://console.cloud.google.com/security/recaptcha?project=_
  const provider = new ReCaptchaEnterpriseProvider("6LcKj7MpAAAAAG4lJ_01234567890abcdefghijklmnopqrstuvwxyz");
  return initializeAppCheck(undefined, { provider, isTokenAutoRefreshEnabled: true });
}), provideFirestore(() => getFirestore()), provideDatabase(() => getDatabase()), provideDataConnect(() => getDataConnect({connector: "example",location: "asia-northeast1",service: "angular-practice"})), provideFunctions(() => getFunctions()), provideMessaging(() => getMessaging()), providePerformance(() => getPerformance()), provideStorage(() => getStorage()), provideRemoteConfig(() => getRemoteConfig()), provideVertexAI(() => getVertexAI())
  ]
};
