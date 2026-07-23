export { PLATFORMS } from './constants/platforms';
export type { PlatformInfo } from './constants/platforms';

export { getDeepLink } from './constants/deep-link';
export type { Platform, ContentType, DeepLinkOptions } from './constants/deep-link';

export { formatRelativeTime, getDaysSinceActivity } from './utils/time';

export { detectEnvironment, isDesktopBrowser } from './utils/environment';
export type { Environment } from './utils/environment';

export { parseXUrl } from './utils/x-parser';
export type { ParsedXUser } from './utils/x-parser';
