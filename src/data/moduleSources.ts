/**
 * Module source definitions and platform integration guides.
 */

export const AUTH_JS_CODE = `/**
 * auth.js - Device Authentication & Hardware MAC Retrieval Module
 * Designed for IPTV applications on Samsung Tizen OS, Android WebView, and Web.
 * 
 * Hardware Detection Priority:
 * 1. Samsung Tizen OS API: tizen.networkinfo.getMacAddress()
 * 2. Android JavascriptInterface: AndroidInterface.getMacAddress()
 * 3. Browser / Standard Fallback: Persistent 12-character hex Device ID stored in localStorage.
 */

const STORAGE_KEY = 'majdsat_device_id';

export function generateHexDeviceId() {
  const chars = '0123456789ABCDEF';
  let deviceId = '';
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

export function formatMacAddress(mac) {
  if (!mac || typeof mac !== 'string') return '';
  const clean = mac.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (clean.length === 12) {
    return clean.match(/.{1,2}/g).join(':');
  }
  return mac.toUpperCase();
}

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

export function getDeviceMac(options = {}) {
  const { formatted = true } = options;
  let rawMac = null;

  // STEP 1: Attempt Samsung Tizen API
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.tizen !== 'undefined' &&
      window.tizen.networkinfo &&
      typeof window.tizen.networkinfo.getMacAddress === 'function'
    ) {
      rawMac = window.tizen.networkinfo.getMacAddress();
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
        rawMac = window.webapis.network.getMac();
      }
    } catch (e) {}
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
      }
    } catch (androidError) {
      console.warn('[auth.js] Error calling AndroidInterface.getMacAddress():', androidError);
      rawMac = null;
    }
  }

  // STEP 3: Fallback to persistent 12-character hex Device ID in localStorage
  if (!rawMac) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        let storedId = window.localStorage.getItem(STORAGE_KEY);
        const cleanStored = storedId ? storedId.replace(/[^a-fA-F0-9]/g, '') : '';
        if (cleanStored.length === 12) {
          rawMac = storedId;
        } else {
          const newHexId = generateHexDeviceId();
          window.localStorage.setItem(STORAGE_KEY, newHexId);
          rawMac = newHexId;
        }
      }
    } catch (storageError) {
      rawMac = generateHexDeviceId();
    }
  }

  if (!rawMac) {
    rawMac = generateHexDeviceId();
  }

  return formatted ? formatMacAddress(rawMac) : rawMac.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
}

export function getDeviceInfo() {
  const platform = detectPlatform();
  const mac = getDeviceMac({ formatted: true });
  return {
    macAddress: mac,
    rawHexId: mac.replace(/[^a-fA-F0-9]/g, '').toUpperCase(),
    platform: platform,
    storageKey: STORAGE_KEY
  };
}

export default {
  getDeviceMac,
  getDeviceInfo,
  detectPlatform,
  formatMacAddress,
  generateHexDeviceId
};
`;

export const API_JS_CODE = `/**
 * api.js - API Polling & Device Activation Lifecycle Module
 * Designed for MajdSat IPTV backend (https://player.majdsat.tn/api)
 * 
 * Flow:
 * - Polls https://player.majdsat.tn/api/check-device via POST every 10 seconds
 * - Transmits device MAC address retrieved via auth.js
 * - Receives response: { status: 'active' | 'trial' | 'expired', playlist_url: string }
 * - Automatically clears polling interval upon 'active' or 'trial'
 * - Transitions application to Home Dashboard
 */

import { getDeviceMac } from './auth.js';

export const API_BASE_URL = 'https://player.majdsat.tn/api';
export const CHECK_DEVICE_ENDPOINT = \`\${API_BASE_URL}/check-device\`;
export const DEFAULT_POLL_INTERVAL_MS = 10000; // 10 seconds

let pollTimerId = null;
let isPolling = false;
let currentPollCount = 0;
let lastKnownStatus = null;
let lastResponseData = null;

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
      throw new Error(\`Server responded with HTTP \${response.status}: \${response.statusText}\`);
    }

    const data = await response.json();
    const normalizedStatus = (data.status || 'unknown').toLowerCase().trim();
    
    lastKnownStatus = normalizedStatus;
    lastResponseData = data;

    return {
      status: normalizedStatus, // 'active' | 'trial' | 'expired'
      playlist_url: data.playlist_url || data.playlistUrl || data.url || '',
      expiry_date: data.expiry_date || data.expiryDate || null,
      raw: data
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err.name === 'AbortError';
    const errorMessage = isAbort 
      ? \`Request timed out after \${timeoutMs / 1000}s\` 
      : (err.message || 'Network request failed');

    return {
      status: 'error',
      error: errorMessage,
      isCorsOrNetwork: !isAbort && (err.name === 'TypeError' || err.message.includes('fetch')),
      timestamp: Date.now()
    };
  }
}

export function startDevicePolling(config = {}) {
  const {
    onTransition = null,
    onStatusUpdate = null,
    onError = null,
    mac = null,
    intervalMs = DEFAULT_POLL_INTERVAL_MS,
    runImmediately = true
  } = config;

  stopDevicePolling();
  isPolling = true;
  currentPollCount = 0;

  const executePollStep = async () => {
    if (!isPolling) return;
    currentPollCount++;

    try {
      const result = await checkDevice(mac);
      if (!isPolling) return;

      if (typeof onStatusUpdate === 'function') {
        onStatusUpdate({
          ...result,
          pollCount: currentPollCount,
          mac: mac || getDeviceMac()
        });
      }

      // Check for activation / trial transition condition
      if (result.status === 'active' || result.status === 'trial') {
        console.log(\`[api.js] Device authorized (\${result.status}). Halting polling & transitioning to Home Dashboard.\`);
        
        // 1. Clear the polling interval immediately as required
        stopDevicePolling();

        // 2. Dispatch global event
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('majdsat:device-activated', {
            detail: {
              status: result.status,
              playlist_url: result.playlist_url,
              mac: mac || getDeviceMac(),
              timestamp: Date.now()
            }
          }));
        }

        // 3. Trigger transition callback
        if (typeof onTransition === 'function') {
          onTransition({
            status: result.status,
            playlist_url: result.playlist_url,
            raw: result.raw,
            mac: mac || getDeviceMac()
          });
        }
      } else if (result.status === 'error') {
        if (typeof onError === 'function') onError(result);
      }
    } catch (err) {
      if (typeof onError === 'function') onError({ status: 'error', error: err.message });
    }
  };

  if (runImmediately) executePollStep();
  pollTimerId = setInterval(executePollStep, intervalMs);

  return stopDevicePolling;
}

export function stopDevicePolling() {
  if (pollTimerId !== null) {
    clearInterval(pollTimerId);
    pollTimerId = null;
  }
  isPolling = false;
}

export default {
  API_BASE_URL,
  CHECK_DEVICE_ENDPOINT,
  DEFAULT_POLL_INTERVAL_MS,
  checkDevice,
  startDevicePolling,
  stopDevicePolling
};
`;

export const PLAYER_JS_CODE = `/**
 * player.js - Unified Cross-Platform Video Player Module
 * Seamlessly handles M3U8 playback across Samsung Tizen OS (AVPlay) and Android / Web (HLS.js)
 */

import Hls from 'hls.js';

export const PLAYER_ENGINE = {
  AVPLAY: 'avplay',     // Samsung Tizen Native AVPlay
  HLSJS: 'hlsjs',       // Android / Web HLS.js
  NATIVE: 'native'      // Safari / iOS Native HLS
};

export const PLAYER_STATE = {
  IDLE: 'IDLE',
  LOADING: 'LOADING',
  READY: 'READY',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  BUFFERING: 'BUFFERING',
  STOPPED: 'STOPPED',
  ERROR: 'ERROR'
};

export function isSamsungTizen() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isTizenUA = /Tizen/i.test(ua) || /SmartTV/i.test(ua);
  const hasAvplay = typeof window.webapis !== 'undefined' && typeof window.webapis.avplay !== 'undefined';
  return isTizenUA || hasAvplay;
}

export class UnifiedVideoPlayer {
  constructor(options = {}) {
    this.videoElement = options.videoElement || null;
    this.containerElement = options.containerElement || null;
    this.autoPlay = options.autoPlay !== false;
    this.timeoutMs = options.timeoutMs || 15000;

    this.onStateChange = options.onStateChange || null;
    this.onBuffering = options.onBuffering || null;
    this.onTimeUpdate = options.onTimeUpdate || null;
    this.onError = options.onError || null;
    this.onReady = options.onReady || null;

    this.currentUrl = null;
    this.state = PLAYER_STATE.IDLE;
    this.currentTime = 0;
    this.duration = 0;
    this.volume = 1.0;
    this.watchdogTimer = null;

    if (options.forceEngine) {
      this.engine = options.forceEngine;
    } else if (isSamsungTizen()) {
      this.engine = PLAYER_ENGINE.AVPLAY;
    } else {
      this.engine = Hls.isSupported() ? PLAYER_ENGINE.HLSJS : PLAYER_ENGINE.NATIVE;
    }

    this.hls = null;
  }

  _setState(newState) {
    if (this.state === newState) return;
    this.state = newState;
    if (this.onStateChange) this.onStateChange(newState);
  }

  _resetWatchdog() {
    this._clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      if (this.state === PLAYER_STATE.LOADING || this.state === PLAYER_STATE.BUFFERING) {
        this._handleError({
          code: 'STREAM_TIMEOUT',
          message: \`Stream connection timed out after \${this.timeoutMs / 1000}s\`,
          fatal: true
        });
      }
    }, this.timeoutMs);
  }

  _clearWatchdog() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  _handleError(error) {
    this._clearWatchdog();
    this._setState(PLAYER_STATE.ERROR);
    if (this.onError) this.onError(error);
  }

  load(url) {
    if (!url) return;
    this.stop();
    this.currentUrl = url;
    this._setState(PLAYER_STATE.LOADING);
    this._resetWatchdog();

    if (this.engine === PLAYER_ENGINE.AVPLAY) {
      this._loadWithAvplay(url);
    } else if (this.engine === PLAYER_ENGINE.HLSJS) {
      this._loadWithHlsJs(url);
    } else {
      this._loadNative(url);
    }
  }

  _loadWithAvplay(streamUrl) {
    if (typeof window === 'undefined' || !window.webapis || !window.webapis.avplay) {
      this.engine = PLAYER_ENGINE.HLSJS;
      this._loadWithHlsJs(streamUrl);
      return;
    }

    const avplay = window.webapis.avplay;
    try {
      try {
        const state = avplay.getState();
        if (state !== 'NONE' && state !== 'IDLE') {
          avplay.stop();
          avplay.close();
        }
      } catch (e) {}

      avplay.open(streamUrl);
      this.setDisplayRect();

      avplay.setListener({
        onbufferingstart: () => {
          this._setState(PLAYER_STATE.BUFFERING);
          if (this.onBuffering) this.onBuffering(true, 0);
          this._resetWatchdog();
        },
        onbufferingprogress: (percent) => {
          if (this.onBuffering) this.onBuffering(true, percent);
        },
        onbufferingcomplete: () => {
          this._clearWatchdog();
          this._setState(PLAYER_STATE.PLAYING);
          if (this.onBuffering) this.onBuffering(false, 100);
        },
        oncurrentplaytime: (timeMs) => {
          this.currentTime = timeMs / 1000;
          try { this.duration = avplay.getDuration() / 1000; } catch (e) { this.duration = 0; }
          if (this.onTimeUpdate) this.onTimeUpdate(this.currentTime, this.duration);
        },
        onevent: (type) => {
          if (type === 'PLAYER_EVENT_STREAM_COMPLETED') this._setState(PLAYER_STATE.STOPPED);
        },
        onerror: (errType) => {
          this._handleError({ code: 'AVPLAY_ERROR', message: \`AVPlay error code: \${errType}\`, fatal: true });
        }
      });

      avplay.prepareAsync(
        () => {
          this._clearWatchdog();
          this._setState(PLAYER_STATE.READY);
          if (this.onReady) this.onReady();
          if (this.autoPlay) {
            avplay.play();
            this._setState(PLAYER_STATE.PLAYING);
          }
        },
        (prepErr) => {
          this._handleError({ code: 'AVPLAY_PREPARE_FAILED', message: JSON.stringify(prepErr), fatal: true });
        }
      );
    } catch (e) {
      this._handleError({ code: 'AVPLAY_EXCEPTION', message: e.message, fatal: true });
    }
  }

  setDisplayRect(x, y, width, height) {
    if (this.engine === PLAYER_ENGINE.AVPLAY && typeof window !== 'undefined' && window.webapis && window.webapis.avplay) {
      try {
        const bounds = this.containerElement ? this.containerElement.getBoundingClientRect() : { left: 0, top: 0, width: 1920, height: 1080 };
        window.webapis.avplay.setDisplayRect(
          x ?? Math.round(bounds.left),
          y ?? Math.round(bounds.top),
          width ?? Math.round(bounds.width),
          height ?? Math.round(bounds.height)
        );
      } catch (e) {}
    }
  }

  _loadWithHlsJs(streamUrl) {
    if (!this.videoElement) return;
    if (this.hls) { this.hls.destroy(); this.hls = null; }

    if (!Hls.isSupported()) {
      if (this.videoElement.canPlayType('application/vnd.apple.mpegurl')) {
        this._loadNative(streamUrl);
        return;
      }
      this._handleError({ code: 'HLS_UNSUPPORTED', message: 'HLS unsupported', fatal: true });
      return;
    }

    this.hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90,
      manifestLoadingTimeOut: 10000
    });

    this.hls.attachMedia(this.videoElement);
    this.hls.on(Hls.Events.MEDIA_ATTACHED, () => this.hls.loadSource(streamUrl));
    this.hls.on(Hls.Events.MANIFEST_PARSED, (e, data) => {
      this._clearWatchdog();
      this._setState(PLAYER_STATE.READY);
      if (this.onReady) this.onReady(data);
      if (this.autoPlay) this.play();
    });

    this.hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) this.hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) this.hls.recoverMediaError();
        else this._handleError({ code: 'HLS_FATAL', message: data.details, fatal: true });
      }
    });

    this._bindVideoEvents();
  }

  _loadNative(streamUrl) {
    if (!this.videoElement) return;
    this.videoElement.src = streamUrl;
    this._bindVideoEvents();
    if (this.autoPlay) this.play();
  }

  _bindVideoEvents() {
    const v = this.videoElement;
    if (!v) return;
    v.onwaiting = () => { this._setState(PLAYER_STATE.BUFFERING); if (this.onBuffering) this.onBuffering(true, 50); };
    v.onplaying = () => { this._clearWatchdog(); this._setState(PLAYER_STATE.PLAYING); if (this.onBuffering) this.onBuffering(false, 100); };
    v.onpause = () => { if (this.state !== PLAYER_STATE.STOPPED) this._setState(PLAYER_STATE.PAUSED); };
    v.ontimeupdate = () => { if (this.onTimeUpdate) this.onTimeUpdate(v.currentTime, v.duration || 0); };
    v.onerror = () => { this._handleError({ code: 'HTML5_ERROR', message: 'Video error', fatal: true }); };
  }

  play() {
    if (this.engine === PLAYER_ENGINE.AVPLAY && typeof window !== 'undefined' && window.webapis && window.webapis.avplay) {
      try { window.webapis.avplay.play(); this._setState(PLAYER_STATE.PLAYING); } catch (e) {}
    } else if (this.videoElement) {
      this.videoElement.play().catch(() => {});
    }
  }

  pause() {
    if (this.engine === PLAYER_ENGINE.AVPLAY && typeof window !== 'undefined' && window.webapis && window.webapis.avplay) {
      try { window.webapis.avplay.pause(); this._setState(PLAYER_STATE.PAUSED); } catch (e) {}
    } else if (this.videoElement) {
      this.videoElement.pause();
      this._setState(PLAYER_STATE.PAUSED);
    }
  }

  stop() {
    this._clearWatchdog();
    if (this.videoElement) { this.videoElement.pause(); }
    if (this.hls) { this.hls.stopLoad(); }
    this._setState(PLAYER_STATE.STOPPED);
  }

  seek(seconds) {
    if (this.videoElement) this.videoElement.currentTime = seconds;
  }

  destroy() {
    this.stop();
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    this._setState(PLAYER_STATE.IDLE);
  }
}

export default UnifiedVideoPlayer;
`;

export const TIZEN_CONFIG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://tizen.org/ns/widgets" 
        xmlns:tizen="http://tizen.org/ns/tizen" 
        id="http://player.majdsat.tn/MajdSatIPTV" 
        version="1.0.0" 
        viewmodes="maximized">
    <tizen:application id="majdsat.iptv" 
                       exec="index.html" 
                       entry="index.html" 
                       type="html" 
                       package="majdsat.iptv" 
                       hw-accel="enable" />
    <name>MajdSat IPTV</name>
    <icon src="icon.png"/>
    
    <!-- CRITICAL TIZEN PRIVILEGES FOR HARDWARE MAC & AVPLAY -->
    <tizen:privilege name="http://tizen.org/privilege/networkinfo"/>
    <tizen:privilege name="http://tizen.org/privilege/internet"/>
    <tizen:privilege name="http://tizen.org/privilege/tv.audio"/>
    <tizen:privilege name="http://developer.samsung.com/privilege/avplay"/>
    <tizen:privilege name="http://developer.samsung.com/privilege/network.public"/>
    
    <!-- ACCESS POLICY TO ALLOW MAJDSAT BACKEND & STREAMS -->
    <access origin="https://player.majdsat.tn" subdomains="true"/>
    <access origin="*" subdomains="true"/>
</widget>`;

export const ANDROID_INTERFACE_JAVA = `package tn.majdsat.iptv;

import android.content.Context;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.webkit.JavascriptInterface;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.List;

/**
 * Android JavascriptInterface for IPTV WebView
 * Injects "AndroidInterface.getMacAddress()" into window object
 */
public class AndroidInterface {
    private Context mContext;

    public AndroidInterface(Context context) {
        this.mContext = context;
    }

    @JavascriptInterface
    public String getMacAddress() {
        try {
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface intf : interfaces) {
                if (intf.getName().equalsIgnoreCase("wlan0") || intf.getName().equalsIgnoreCase("eth0")) {
                    byte[] mac = intf.getHardwareAddress();
                    if (mac == null) return "";
                    StringBuilder buf = new StringBuilder();
                    for (byte aMac : mac) {
                        buf.append(String.format("%02X:", aMac));
                    }
                    if (buf.length() > 0) {
                        buf.deleteCharAt(buf.length() - 1);
                    }
                    return buf.toString();
                }
            }
        } catch (Exception ex) {
            ex.printStackTrace();
        }
        return "";
    }
}

// In your MainActivity.java:
// WebView myWebView = findViewById(R.id.webview);
// myWebView.getSettings().setJavaScriptEnabled(true);
// myWebView.addJavascriptInterface(new AndroidInterface(this), "AndroidInterface");
`;
