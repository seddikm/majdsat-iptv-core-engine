/**
 * api.js - API Polling & Device Activation Lifecycle Module
 * Designed for MajdSat IPTV backend (https://player.majdsat.tn/api)
 * 
 * Flow:
 * - Polls https://player.majdsat.tn/api/check-device via POST every 10 seconds
 * - Transmits device MAC address retrieved via auth.js
 * - Receives response: { status: 'active' | 'trial' | 'expired', playlist_url: string }
 * - Automatically clears polling interval upon 'active' or 'trial'
 * - Transitions application to Home Dashboard
 * 
 * @author Senior Cross-Platform IPTV Developer
 */

import { getDeviceMac } from './auth.js';

// Configuration
export const API_BASE_URL = 'https://player.majdsat.tn/api';
export const CHECK_DEVICE_ENDPOINT = `${API_BASE_URL}/check-device`;
export const DEFAULT_POLL_INTERVAL_MS = 10000; // 10 seconds as specified

// Module Internal State
let pollTimerId = null;
let isPolling = false;
let currentPollCount = 0;
let lastKnownStatus = null;
let lastResponseData = null;

/**
 * Single asynchronous check against https://player.majdsat.tn/api/check-device
 * 
 * @param {string} [customMac] - Optional MAC override; defaults to auth.js getDeviceMac()
 * @param {Object} [options]
 * @param {string} [options.endpoint] - Optional custom endpoint
 * @param {number} [options.timeoutMs=8000] - Request timeout
 * @returns {Promise<{ status: 'active' | 'trial' | 'expired' | 'error', playlist_url?: string, raw?: any, error?: string }>}
 */
export async function checkDevice(customMac = null, options = {}) {
  const mac = customMac || getDeviceMac({ formatted: true });
  const rawMac = mac.replace(/[^a-fA-F0-9]/g, '');
  const endpoint = options.endpoint || CHECK_DEVICE_ENDPOINT;
  const timeoutMs = options.timeoutMs || 8000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const payload = {
    mac: mac,
    mac_address: mac,
    raw_mac: rawMac,
    timestamp: Date.now()
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Server responded with HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Normalize status strings to lowercase
    const normalizedStatus = (data.status || 'unknown').toLowerCase().trim();
    
    lastKnownStatus = normalizedStatus;
    lastResponseData = data;

    return {
      status: normalizedStatus, // 'active' | 'trial' | 'expired'
      playlist_url: data.playlist_url || data.playlistUrl || data.url || '',
      expiry_date: data.expiry_date || data.expiryDate || data.expires_at || null,
      raw: data
    };
  } catch (err) {
    clearTimeout(timeoutId);

    const isAbort = err.name === 'AbortError';
    const errorMessage = isAbort 
      ? `Request timed out after ${timeoutMs / 1000}s` 
      : (err.message || 'Network request failed');

    // In web browsers, CORS restrictions might block direct fetch to an external API 
    // without Access-Control-Allow-Origin headers. Attempt proxy fallback if available
    const isCorsOrNetwork = !isAbort && (err.name === 'TypeError' || (err.message && err.message.includes('fetch')));
    if (isCorsOrNetwork && endpoint === CHECK_DEVICE_ENDPOINT && typeof window !== 'undefined' && window.location) {
      try {
        const proxyEndpoint = '/api-proxy/api/check-device';
        const proxyResp = await fetch(proxyEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (proxyResp.ok) {
          const proxyData = await proxyResp.json();
          const normStatus = (proxyData.status || 'unknown').toLowerCase().trim();
          lastKnownStatus = normStatus;
          lastResponseData = proxyData;
          return {
            status: normStatus,
            playlist_url: proxyData.playlist_url || proxyData.playlistUrl || proxyData.url || '',
            expiry_date: proxyData.expiry_date || proxyData.expiryDate || null,
            raw: proxyData
          };
        }
      } catch (proxyErr) {
        // Continue to return original error report
      }
    }

    console.warn(`[api.js] Device check failed (${endpoint}):`, errorMessage);

    return {
      status: 'error',
      error: errorMessage,
      isCorsOrNetwork: isCorsOrNetwork,
      timestamp: Date.now()
    };
  }
}

/**
 * Starts continuous polling every 10 seconds.
 * Automatically clears the interval and executes onTransition once status is 'active' or 'trial'.
 * 
 * @param {Object} config
 * @param {Function} [config.onTransition] - Callback when activated: fn({ status, playlist_url, mac })
 * @param {Function} [config.onStatusUpdate] - Callback on each poll attempt: fn({ status, playlist_url, count })
 * @param {Function} [config.onError] - Callback on error: fn(errorObj)
 * @param {string} [config.mac] - Custom MAC address override
 * @param {number} [config.intervalMs=10000] - Polling interval (defaults to 10000)
 * @param {boolean} [config.runImmediately=true] - Whether to fire immediately upon starting
 * @returns {() => void} Function to stop polling
 */
export function startDevicePolling(config = {}) {
  const {
    onTransition = null,
    onStatusUpdate = null,
    onError = null,
    mac = null,
    intervalMs = DEFAULT_POLL_INTERVAL_MS,
    runImmediately = true
  } = config;

  // Stop any existing polling routine first
  stopDevicePolling();

  isPolling = true;
  currentPollCount = 0;

  const executePollStep = async () => {
    if (!isPolling) return;

    currentPollCount++;

    try {
      const result = await checkDevice(mac);

      if (!isPolling) return; // Polling might have been cancelled during network fetch

      if (typeof onStatusUpdate === 'function') {
        onStatusUpdate({
          ...result,
          pollCount: currentPollCount,
          mac: mac || getDeviceMac()
        });
      }

      // Check for activation / trial transition condition
      if (result.status === 'active' || result.status === 'trial') {
        console.log(`[api.js] Device authorized with status: "${result.status}". Halting polling & transitioning to Home Dashboard.`);
        
        // 1. Clear the polling interval immediately as required
        stopDevicePolling();

        // 2. Persist active session in sessionStorage for resilient reload
        try {
          if (typeof window !== 'undefined' && window.sessionStorage) {
            window.sessionStorage.setItem('majdsat_active_session', JSON.stringify({
              status: result.status,
              playlist_url: result.playlist_url,
              mac: mac || getDeviceMac(),
              activated_at: Date.now()
            }));
          }
        } catch (e) {
          // ignore session storage failure
        }

        // 3. Dispatch global custom event for SPA router / dashboard listener
        if (typeof window !== 'undefined') {
          const transitionEvent = new CustomEvent('majdsat:device-activated', {
            detail: {
              status: result.status,
              playlist_url: result.playlist_url,
              mac: mac || getDeviceMac(),
              timestamp: Date.now()
            }
          });
          window.dispatchEvent(transitionEvent);
        }

        // 4. Trigger caller's transition callback
        if (typeof onTransition === 'function') {
          onTransition({
            status: result.status,
            playlist_url: result.playlist_url,
            raw: result.raw,
            mac: mac || getDeviceMac()
          });
        }
      } else if (result.status === 'error') {
        if (typeof onError === 'function') {
          onError(result);
        }
      }
    } catch (err) {
      if (typeof onError === 'function') {
        onError({ status: 'error', error: err.message });
      }
    }
  };

  // Run initial poll immediately if configured
  if (runImmediately) {
    executePollStep();
  }

  // Set 10-second polling interval
  pollTimerId = setInterval(executePollStep, intervalMs);

  return stopDevicePolling;
}

/**
 * Halts any active device polling interval.
 */
export function stopDevicePolling() {
  if (pollTimerId !== null) {
    clearInterval(pollTimerId);
    pollTimerId = null;
  }
  isPolling = false;
}

/**
 * Query current polling status.
 * @returns {boolean}
 */
export function isPollingActive() {
  return isPolling;
}

/**
 * Retrieves the last received server status.
 * @returns {string|null}
 */
export function getLastStatus() {
  return lastKnownStatus;
}

/**
 * Retrieves the last full server payload.
 * @returns {any}
 */
export function getLastResponse() {
  return lastResponseData;
}

export default {
  API_BASE_URL,
  CHECK_DEVICE_ENDPOINT,
  DEFAULT_POLL_INTERVAL_MS,
  checkDevice,
  startDevicePolling,
  stopDevicePolling,
  isPollingActive,
  getLastStatus,
  getLastResponse
};
