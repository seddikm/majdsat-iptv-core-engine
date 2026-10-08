/**
 * auth.js - Device Authentication & Hardware MAC Retrieval Module
 * Designed for IPTV applications on Samsung Tizen OS, Android WebView, and Web.
 * 
 * Hardware Detection Priority:
 * 1. Samsung Tizen OS API: tizen.networkinfo.getMacAddress()
 * 2. Android JavascriptInterface: AndroidInterface.getMacAddress()
 * 3. Browser / Standard Fallback: Persistent 12-character hex Device ID stored in localStorage.
 * 
 * @author Senior Cross-Platform IPTV Developer
 */

const STORAGE_KEY = 'majdsat_device_id';

/**
 * Generates a pseudo-random 12-character hexadecimal string.
 * Format: 12 uppercase hex characters (e.g. "A1B2C3D4E5F6").
 * @returns {string} 12-character hex string
 */
export function generateHexDeviceId() {
  const chars = '0123456789ABCDEF';
  let deviceId = '';
  // Use crypto.getRandomValues if available for cryptographic randomness, fallback to Math.random
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const bytes = new Uint8Array(6);
    window.crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) {
      deviceId += bytes[i].toString(16).padStart(2, '0').toUpperCase();
    }
  } else {
    for (let i = 0; i < 12; i++) {
      deviceId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }
  return deviceId;
}

/**
 * Normalizes any MAC address string into uppercase colon-separated format (XX:XX:XX:XX:XX:XX)
 * or returns the raw string if already valid.
 * @param {string} mac 
 * @returns {string}
 */
export function formatMacAddress(mac) {
  if (!mac || typeof mac !== 'string') return '';
  // Remove non-alphanumeric characters
  const clean = mac.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (clean.length === 12) {
    return clean.match(/.{1,2}/g).join(':');
  }
  return mac.toUpperCase();
}

/**
 * Detects the runtime platform environment.
 * @returns {'tizen' | 'android' | 'web'}
 */
export function detectPlatform() {
  if (typeof window === 'undefined') return 'web';

  // 1. Check Tizen environment
  const isTizenObject = typeof window.tizen !== 'undefined';
  const isTizenUA = /Tizen/i.test(navigator.userAgent) || /SmartTV/i.test(navigator.userAgent);
  if (isTizenObject || isTizenUA) {
    return 'tizen';
  }

  // 2. Check Android JavascriptInterface
  const hasAndroidInterface = typeof window.AndroidInterface !== 'undefined';
  const isAndroidUA = /Android/i.test(navigator.userAgent);
  if (hasAndroidInterface || (isAndroidUA && window.AndroidInterface)) {
    return 'android';
  }

  return 'web';
}

/**
 * Retrieves the hardware MAC address or persistent Device ID.
 * 
 * Execution Flow:
 * 1. Checks Tizen API (tizen.networkinfo.getMacAddress)
 * 2. Checks Android JavascriptInterface (AndroidInterface.getMacAddress())
 * 3. Fallbacks to persistent 12-char hex Device ID in localStorage
 * 
 * @param {Object} options
 * @param {boolean} [options.formatted=true] - Whether to return colon-separated format (XX:XX:XX:XX:XX:XX)
 * @returns {string} The resolved MAC address or 12-character hex ID
 */
export function getDeviceMac(options = {}) {
  const { formatted = true } = options;

  let rawMac = null;
  let source = 'unknown';

  // STEP 1: Attempt Samsung Tizen API
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.tizen !== 'undefined' &&
      window.tizen.networkinfo &&
      typeof window.tizen.networkinfo.getMacAddress === 'function'
    ) {
      rawMac = window.tizen.networkinfo.getMacAddress();
      if (rawMac && typeof rawMac === 'string' && rawMac.trim().length > 0) {
        source = 'tizen-networkinfo';
      } else {
        rawMac = null;
      }
    }
  } catch (tizenError) {
    console.warn('[auth.js] Error calling tizen.networkinfo.getMacAddress:', tizenError);
    rawMac = null;
  }

  // Optional Tizen WebAPIs secondary check if networkinfo didn't yield MAC
  if (!rawMac) {
    try {
      if (
        typeof window !== 'undefined' &&
        typeof window.webapis !== 'undefined' &&
        window.webapis.network &&
        typeof window.webapis.network.getMac === 'function'
      ) {
        const webapisMac = window.webapis.network.getMac();
        if (webapisMac && typeof webapisMac === 'string') {
          rawMac = webapisMac;
          source = 'tizen-webapis';
        }
      }
    } catch (e) {
      // Ignore webapis errors
    }
  }

  // STEP 2: Attempt Android JavascriptInterface
  if (!rawMac) {
    try {
      if (
        typeof window !== 'undefined' &&
        typeof window.AndroidInterface !== 'undefined' &&
        typeof window.AndroidInterface.getMacAddress === 'function'
      ) {
        rawMac = window.AndroidInterface.getMacAddress();
        if (rawMac && typeof rawMac === 'string' && rawMac.trim().length > 0) {
          source = 'android-interface';
        } else {
          rawMac = null;
        }
      }
    } catch (androidError) {
      console.warn('[auth.js] Error calling AndroidInterface.getMacAddress():', androidError);
      rawMac = null;
    }
  }

  // STEP 3: Fallback to persistent 12-character hex Device ID in localStorage
  if (!rawMac) {
    source = 'local-storage-fallback';
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        let storedId = window.localStorage.getItem(STORAGE_KEY);
        // Validate stored ID: must be 12 hex chars or 17-char colon format
        const cleanStored = storedId ? storedId.replace(/[^a-fA-F0-9]/g, '') : '';
        if (cleanStored.length === 12) {
          rawMac = storedId;
        } else {
          // Generate new 12-char hex ID
          const newHexId = generateHexDeviceId();
          window.localStorage.setItem(STORAGE_KEY, newHexId);
          rawMac = newHexId;
        }
      }
    } catch (storageError) {
      console.warn('[auth.js] LocalStorage inaccessible, generating ephemeral ID:', storageError);
      rawMac = generateHexDeviceId();
    }
  }

  // If still empty (e.g. in non-browser context), generate directly
  if (!rawMac) {
    rawMac = generateHexDeviceId();
    source = 'ephemeral';
  }

  const finalMac = formatted ? formatMacAddress(rawMac) : rawMac.replace(/[^a-fA-F0-9]/g, '').toUpperCase();

  // Log in debug mode
  if (typeof window !== 'undefined' && window.__IPTV_DEBUG__) {
    console.log(`[auth.js] Resolved Device MAC: ${finalMac} (Source: ${source})`);
  }

  return finalMac;
}

/**
 * Returns comprehensive device authentication metadata.
 * Useful for debugging, UI diagnostics, and backend registration.
 * @returns {Object}
 */
export function getDeviceInfo() {
  const platform = detectPlatform();
  const mac = getDeviceMac({ formatted: true });
  const rawHex = mac.replace(/[^a-fA-F0-9]/g, '').toUpperCase();

  return {
    macAddress: mac,
    rawHexId: rawHex,
    platform: platform,
    isTizenAvailable: typeof window !== 'undefined' && typeof window.tizen !== 'undefined',
    isAndroidInterfaceAvailable: typeof window !== 'undefined' && typeof window.AndroidInterface !== 'undefined',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    storageKey: STORAGE_KEY
  };
}

/**
 * Resets the fallback device ID in localStorage.
 * Useful when testing or re-provisioning test devices.
 * @returns {string} The newly generated MAC
 */
export function resetFallbackDeviceId() {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(STORAGE_KEY);
  }
  return getDeviceMac({ formatted: true });
}

export default {
  getDeviceMac,
  getDeviceInfo,
  detectPlatform,
  formatMacAddress,
  generateHexDeviceId,
  resetFallbackDeviceId
};
