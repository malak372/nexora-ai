import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  App,
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';

import {
  FIREBASE_APPLICATION_DEFAULT_MESSAGE,
  FIREBASE_CLIENT_EMAIL_KEY,
  FIREBASE_EXISTING_APP_MESSAGE,
  FIREBASE_INITIALIZATION_FAILURE_MESSAGE,
  FIREBASE_INITIALIZATION_SUCCESS_MESSAGE,
  FIREBASE_MESSAGING_UNAVAILABLE_MESSAGE,
  FIREBASE_PRIVATE_KEY_KEY,
  FIREBASE_PROJECT_ID_KEY,
  FIREBASE_SERVICE_ACCOUNT_INCOMPLETE_MESSAGE,
  FIREBASE_SERVICE_ACCOUNT_MESSAGE,
} from '../constants/firebase.constants';

/**
 * Initializes and exposes the Firebase Admin SDK.
 *
 * Responsibilities:
 * - Initialize Firebase Admin exactly once.
 * - Reuse an existing Firebase application when available.
 * - Load service-account credentials through ConfigService.
 * - Fall back to Application Default Credentials when appropriate.
 * - Expose the Firebase Messaging client to the push-delivery layer.
 *
 * This service contains no notification business logic.
 *
 * @author Eman
 */
@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);

  private firebaseApp: App | null = null;
  private messaging: Messaging | null = null;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Initializes Firebase when the NestJS module starts.
   */
  onModuleInit(): void {
    this.initializeFirebase();
  }

  /**
   * Returns the initialized Firebase Messaging client.
   *
   * @throws InternalServerErrorException when Firebase has not
   * been initialized successfully.
   */
  getMessaging(): Messaging {
    if (!this.messaging) {
      throw new InternalServerErrorException(
        FIREBASE_MESSAGING_UNAVAILABLE_MESSAGE,
      );
    }

    return this.messaging;
  }

  /**
   * Initializes Firebase Admin exactly once.
   */
  private initializeFirebase(): void {
    try {
      const existingApp = getApps()[0];

      if (existingApp) {
        this.firebaseApp = existingApp;
        this.messaging = getMessaging(existingApp);

        this.logger.log(FIREBASE_EXISTING_APP_MESSAGE);
        return;
      }

      const projectId = this.getOptionalConfig(FIREBASE_PROJECT_ID_KEY);
      const clientEmail = this.getOptionalConfig(FIREBASE_CLIENT_EMAIL_KEY);
      const privateKey = this.getOptionalConfig(FIREBASE_PRIVATE_KEY_KEY);

      this.validateCredentialCompleteness({
        projectId,
        clientEmail,
        privateKey,
      });

      this.firebaseApp =
        projectId && clientEmail && privateKey
          ? this.initializeWithServiceAccount({
              projectId,
              clientEmail,
              privateKey,
            })
          : this.initializeWithApplicationDefaultCredentials();

      this.messaging = getMessaging(this.firebaseApp);

      this.logger.log(FIREBASE_INITIALIZATION_SUCCESS_MESSAGE);
    } catch (error: unknown) {
      this.logger.error(
        FIREBASE_INITIALIZATION_FAILURE_MESSAGE,
        this.getErrorStack(error),
      );

      throw new InternalServerErrorException(
        FIREBASE_INITIALIZATION_FAILURE_MESSAGE,
      );
    }
  }

  /**
   * Initializes Firebase using explicit service-account credentials.
   */
  private initializeWithServiceAccount(input: {
    projectId: string;
    clientEmail: string;
    privateKey: string;
  }): App {
    const app = initializeApp({
      credential: cert({
        projectId: input.projectId,
        clientEmail: input.clientEmail,
        privateKey: this.normalizePrivateKey(input.privateKey),
      }),
    });

    this.logger.log(FIREBASE_SERVICE_ACCOUNT_MESSAGE);

    return app;
  }

  /**
   * Initializes Firebase using Application Default Credentials.
   */
  private initializeWithApplicationDefaultCredentials(): App {
    const app = initializeApp({
      credential: applicationDefault(),
    });

    this.logger.warn(FIREBASE_APPLICATION_DEFAULT_MESSAGE);

    return app;
  }

  /**
   * Reads and trims an optional configuration value.
   */
  private getOptionalConfig(key: string): string | undefined {
    const value = this.configService.get<string>(key)?.trim();

    return value || undefined;
  }

  /**
   * Ensures service-account credentials are either fully configured
   * or completely omitted.
   */
  private validateCredentialCompleteness(input: {
    projectId?: string;
    clientEmail?: string;
    privateKey?: string;
  }): void {
    const configuredValues = [
      input.projectId,
      input.clientEmail,
      input.privateKey,
    ].filter(Boolean).length;

    if (configuredValues > 0 && configuredValues < 3) {
      throw new Error(FIREBASE_SERVICE_ACCOUNT_INCOMPLETE_MESSAGE);
    }
  }

  /**
   * Converts escaped newline characters from environment variables
   * into the PEM format expected by Firebase.
   */
  private normalizePrivateKey(privateKey: string): string {
    return privateKey.replace(/\\n/g, '\n');
  }

  /**
   * Safely extracts an error stack for application logging.
   */
  private getErrorStack(error: unknown): string | undefined {
    return error instanceof Error ? error.stack : undefined;
  }
}
