// SPDX-License-Identifier: AGPL-3.0-only
// What the avatar needs from the page it runs in. A host calls configureAvatar once at startup; the defaults
// suit a page with public model URLs and the Cubism Core script at the site root.
type Logger = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

export type AvatarTranslationKey = 'inochi2d.initializing' | 'inochi2d.loadingModel' | 'inochi2d.missingUrl';
export type AvatarTranslate = (key: AvatarTranslationKey) => string;

export type AvatarHost = {
  logger: Logger;
  /** Where the Live2D Cubism Core script is served from; only Live2D models load it. */
  cubismCoreUrl: string;
  /** Whether private model files need signed URLs at runtime. */
  assetPresignEnabled: boolean;
  /** Model URLs under this base are public: a failed signing falls back to loading them directly. */
  publicModelBaseUrl?: string;
  /** Signs model file URLs for a courseware; called only while assetPresignEnabled is true. */
  presignModelUrls: (coursewareId: string | undefined, urls: string[], renderToken?: string) => Promise<Record<string, string>>;
  /** A React hook, so a host's translations can follow its language switch. */
  useTranslate: () => AvatarTranslate;
};

const ENGLISH: Record<AvatarTranslationKey, string> = {
  'inochi2d.initializing': 'Initializing Inochi2D…',
  'inochi2d.loadingModel': 'Loading Inochi2D model…',
  'inochi2d.missingUrl': 'Please provide an Inochi2D model URL (.inx)',
};
const translateEnglish: AvatarTranslate = (key) => ENGLISH[key];

const silentDebug: Logger = {
  debug: () => undefined,
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

let host: AvatarHost = {
  logger: silentDebug,
  cubismCoreUrl: '/live2dcubismcore.min.js',
  assetPresignEnabled: false,
  presignModelUrls: async () => {
    throw new Error('@ainobi/avatar: configureAvatar({ presignModelUrls }) is required for private models');
  },
  useTranslate: () => translateEnglish,
};

export function configureAvatar(overrides: Partial<AvatarHost>): void {
  host = { ...host, ...overrides };
}

export const logger: Logger = {
  debug: (...args) => host.logger.debug(...args),
  info: (...args) => host.logger.info(...args),
  warn: (...args) => host.logger.warn(...args),
  error: (...args) => host.logger.error(...args),
};
export const cubismCoreUrl = (): string => host.cubismCoreUrl;
export const publicModelBaseUrl = (): string | undefined => host.publicModelBaseUrl;
export const isAssetPresignEnabled = (): boolean => host.assetPresignEnabled;
export const presignModelUrls: AvatarHost['presignModelUrls'] = (coursewareId, urls, renderToken) =>
  host.presignModelUrls(coursewareId, urls, renderToken);
export const useAvatarTranslate = (): AvatarTranslate => host.useTranslate();
