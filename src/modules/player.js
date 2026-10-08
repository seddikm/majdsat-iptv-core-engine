/**
 * player.js - Unified Cross-Platform Video Player Module
 * Seamlessly handles M3U8 playback across Samsung Tizen OS (AVPlay) and Android / Web (HLS.js)
 * 
 * Hardware & Platform Strategy:
 * 1. Samsung Tizen OS (Smart TV):
 *    - Detects Tizen via User-Agent and window.webapis.avplay
 *    - Uses hardware accelerated webapis.avplay API
 *    - Handles display rect positioning, AVPlay listener callbacks, prepareAsync, and playback lifecycle
 * 2. Android WebView / Modern Browsers:
 *    - Uses HLS.js library attached to standard HTML5 <video> element
 *    - Fallback to native Safari / Apple HLS streaming where supported
 * 3. Robust Error Handling:
 *    - Stream watchdog for network stalls and load timeouts
 *    - Media error recovery and unsupported format detection
 * 
 * @author Senior Cross-Platform IPTV Developer
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

/**
 * Checks if current runtime is a Samsung Tizen Smart TV.
 * @returns {boolean}
 */
export function isSamsungTizen() {
  if (typeof window === 'undefined') return false;

  const ua = navigator.userAgent || '';
  const isTizenUA = /Tizen/i.test(ua) || /SmartTV/i.test(ua);
  const hasAvplay = typeof window.webapis !== 'undefined' && typeof window.webapis.avplay !== 'undefined';

  return isTizenUA || hasAvplay;
}

/**
 * UnifiedVideoPlayer Class
 */
export class UnifiedVideoPlayer {
  /**
   * @param {Object} options
   * @param {HTMLVideoElement} [options.videoElement] - Target video element (for HLS.js / HTML5)
   * @param {HTMLElement} [options.containerElement] - Outer container (used for AVPlay display rect)
   * @param {boolean} [options.autoPlay=true] - Auto-play upon stream load
   * @param {number} [options.timeoutMs=15000] - Stream watchdog timeout
   * @param {Function} [options.onStateChange] - State change callback
   * @param {Function} [options.onBuffering] - Buffering event callback (isBuffering, percent)
   * @param {Function} [options.onTimeUpdate] - Time update callback (currentTime, duration)
   * @param {Function} [options.onError] - Error callback (errorObj)
   * @param {Function} [options.onReady] - Ready callback
   * @param {string} [options.forceEngine] - Force 'avplay' | 'hlsjs' for testing
   */
  constructor(options = {}) {
    this.videoElement = options.videoElement || null;
    this.containerElement = options.containerElement || null;
    this.autoPlay = options.autoPlay !== false;
    this.timeoutMs = options.timeoutMs || 15000;

    // Callbacks
    this.onStateChange = options.onStateChange || null;
    this.onBuffering = options.onBuffering || null;
    this.onTimeUpdate = options.onTimeUpdate || null;
    this.onError = options.onError || null;
    this.onReady = options.onReady || null;

    // Internal State
    this.currentUrl = null;
    this.state = PLAYER_STATE.IDLE;
    this.currentTime = 0;
    this.duration = 0;
    this.volume = 1.0;
    this.isMuted = false;
    this.watchdogTimer = null;
    this.displayRect = { x: 0, y: 0, width: 1920, height: 1080 };

    // Determine Engine
    if (options.forceEngine) {
      this.engine = options.forceEngine;
    } else if (isSamsungTizen()) {
      this.engine = PLAYER_ENGINE.AVPLAY;
    } else {
      this.engine = Hls.isSupported() ? PLAYER_ENGINE.HLSJS : PLAYER_ENGINE.NATIVE;
    }

    // Engine Instances
    this.hls = null;
    this.isAvplayPrepared = false;

    console.log(`[player.js] UnifiedVideoPlayer initialized using engine: "${this.engine}"`);
  }

  /**
   * Updates internal state and notifies callback
   * @param {string} newState 
   */
  _setState(newState) {
    if (this.state === newState) return;
    this.state = newState;
    if (typeof this.onStateChange === 'function') {
      this.onStateChange(newState);
    }
  }

  /**
   * Resets stream watchdog timer
   */
  _resetWatchdog() {
    this._clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      if (this.state === PLAYER_STATE.LOADING || this.state === PLAYER_STATE.BUFFERING) {
        this._handleError({
          code: 'STREAM_TIMEOUT',
          message: `Stream connection timed out after ${this.timeoutMs / 1000}s`,
          fatal: true
        });
      }
    }, this.timeoutMs);
  }

  /**
   * Clears stream watchdog timer
   */
  _clearWatchdog() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /**
   * Central error dispatcher
   * @param {Object} error 
   */
  _handleError(error) {
    this._clearWatchdog();
    this._setState(PLAYER_STATE.ERROR);
    console.error('[player.js] Player Error:', error);
    if (typeof this.onError === 'function') {
      this.onError(error);
    }
  }

  /**
   * Loads and initiates playback for an M3U8 stream URL
   * @param {string} url - M3U8 stream URL
   */
  load(url) {
    if (!url || typeof url !== 'string') {
      this._handleError({ code: 'INVALID_URL', message: 'Invalid or empty stream URL provided', fatal: true });
      return;
    }

    // Stop and clean up any active stream
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

  // =========================================================================
  // SAMSUNG TIZEN AVPLAY IMPLEMENTATION
  // =========================================================================

  /**
   * Prepares and starts stream via Samsung Tizen webapis.avplay
   * @param {string} streamUrl 
   */
  _loadWithAvplay(streamUrl) {
    // Check if webapis is physically present or simulated
    const hasPhysicalAvplay = typeof window !== 'undefined' && 
                              typeof window.webapis !== 'undefined' && 
                              typeof window.webapis.avplay !== 'undefined';

    if (!hasPhysicalAvplay) {
      console.warn('[player.js] Tizen environment detected but window.webapis.avplay is unavailable. Falling back to HLS.js for browser emulation.');
      this.engine = PLAYER_ENGINE.HLSJS;
      this._loadWithHlsJs(streamUrl);
      return;
    }

    const avplay = window.webapis.avplay;

    try {
      // 1. Close any prior AVPlay instance
      try {
        const state = avplay.getState();
        if (state !== 'NONE' && state !== 'IDLE') {
          avplay.stop();
          avplay.close();
        }
      } catch (e) {
        // Safe to ignore in case state is uninitialized
      }

      // 2. Open stream URL
      avplay.open(streamUrl);

      // 3. Set display rectangle (1080p canvas coordinates standard for Tizen)
      this.updateAvplayDisplayRect();

      // 4. Register AVPlay event listeners
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
        oncurrentplaytime: (currentTimeMs) => {
          this.currentTime = currentTimeMs / 1000;
          try {
            this.duration = avplay.getDuration() / 1000;
          } catch (e) {
            this.duration = 0;
          }
          if (this.onTimeUpdate) {
            this.onTimeUpdate(this.currentTime, this.duration);
          }
        },
        onevent: (eventType, eventData) => {
          if (eventType === 'PLAYER_EVENT_STREAM_COMPLETED') {
            this._setState(PLAYER_STATE.STOPPED);
          }
        },
        onerror: (errorType) => {
          this._handleError({
            code: 'TIZEN_AVPLAY_ERROR',
            message: `AVPlay reported error code: ${errorType}`,
            errorType: errorType,
            fatal: true
          });
        },
        onsubtitlechange: () => {},
        ondrmevent: () => {}
      });

      // 5. Prepare asynchronously as recommended by Samsung guidelines
      avplay.prepareAsync(
        () => {
          this.isAvplayPrepared = true;
          this._clearWatchdog();
          this._setState(PLAYER_STATE.READY);
          if (this.onReady) this.onReady();

          if (this.autoPlay) {
            try {
              avplay.play();
              this._setState(PLAYER_STATE.PLAYING);
            } catch (playErr) {
              console.error('[player.js] AVPlay play() error:', playErr);
            }
          }
        },
        (prepareError) => {
          this._handleError({
            code: 'TIZEN_PREPARE_FAILED',
            message: `AVPlay prepareAsync failed: ${JSON.stringify(prepareError)}`,
            fatal: true
          });
        }
      );
    } catch (err) {
      this._handleError({
        code: 'TIZEN_INITIALIZATION_EXCEPTION',
        message: err.message || 'Exception during AVPlay initialization',
        fatal: true
      });
    }
  }

  /**
   * Sets or updates AVPlay display rect based on container bounds
   * @param {number} [x] 
   * @param {number} [y] 
   * @param {number} [width] 
   * @param {number} [height] 
   */
  setDisplayRect(x, y, width, height) {
    if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
      this.displayRect = { x, y, width, height };
    } else if (this.containerElement) {
      const rect = this.containerElement.getBoundingClientRect();
      this.displayRect = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    }

    if (this.engine === PLAYER_ENGINE.AVPLAY && typeof window !== 'undefined' && window.webapis && window.webapis.avplay) {
      try {
        window.webapis.avplay.setDisplayRect(
          this.displayRect.x,
          this.displayRect.y,
          this.displayRect.width,
          this.displayRect.height
        );
      } catch (e) {
        console.warn('[player.js] AVPlay setDisplayRect error:', e);
      }
    }
  }

  updateAvplayDisplayRect() {
    this.setDisplayRect();
  }

  // =========================================================================
  // ANDROID & STANDARD BROWSER HLS.JS IMPLEMENTATION
  // =========================================================================

  /**
   * Prepares and starts stream via HLS.js
   * @param {string} streamUrl 
   */
  _loadWithHlsJs(streamUrl) {
    if (!this.videoElement) {
      this._handleError({
        code: 'NO_VIDEO_ELEMENT',
        message: 'No HTMLVideoElement provided for HLS.js engine',
        fatal: true
      });
      return;
    }

    // Clean previous Hls instance
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    // Verify HLS.js browser support
    if (!Hls.isSupported()) {
      if (this.videoElement.canPlayType('application/vnd.apple.mpegurl')) {
        this._loadNative(streamUrl);
        return;
      }
      this._handleError({
        code: 'HLS_UNSUPPORTED',
        message: 'HLS streaming is not supported on this browser/webview',
        fatal: true
      });
      return;
    }

    // Configure HLS.js with robust IPTV streaming settings
    this.hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      manifestLoadingTimeOut: 10000,
      manifestLoadingMaxRetry: 4,
      levelLoadingTimeOut: 10000,
      fragLoadingTimeOut: 12000,
      fragLoadingMaxRetry: 4
    });

    // Attach HLS instance to video element
    this.hls.attachMedia(this.videoElement);

    // Event: Media Attached
    this.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      this.hls.loadSource(streamUrl);
    });

    // Event: Manifest Parsed
    this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      this._clearWatchdog();
      this._setState(PLAYER_STATE.READY);
      if (this.onReady) this.onReady(data);

      if (this.autoPlay) {
        this.play();
      }
    });

    // Event: Error Handling with automatic recovery routines
    this.hls.on(Hls.Events.ERROR, (event, data) => {
      console.warn('[player.js] HLS.js Event Error:', data.type, data.details);

      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.log('[player.js] Fatal network error encountered, attempting recovery via startLoad()...');
            this.hls.startLoad();
            break;

          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('[player.js] Fatal media error encountered, attempting recoverMediaError()...');
            this.hls.recoverMediaError();
            break;

          default:
            this._handleError({
              code: 'HLS_FATAL_ERROR',
              message: `Fatal HLS error: ${data.details}`,
              details: data,
              fatal: true
            });
            this.stop();
            break;
        }
      } else {
        // Non-fatal error (buffer stall, minor fragment drop)
        if (data.details === 'bufferStalledError') {
          this._setState(PLAYER_STATE.BUFFERING);
          if (this.onBuffering) this.onBuffering(true, 50);
        }
      }
    });

    // Bind HTML5 Video events
    this._bindVideoEvents();
  }

  /**
   * Fallback for Safari / Native iOS / Android Native HLS
   * @param {string} streamUrl 
   */
  _loadNative(streamUrl) {
    if (!this.videoElement) return;

    this.videoElement.src = streamUrl;
    this._bindVideoEvents();

    if (this.autoPlay) {
      this.play();
    }
  }

  /**
   * Binds HTML5 Video event listeners
   */
  _bindVideoEvents() {
    if (!this.videoElement) return;

    const v = this.videoElement;

    v.onwaiting = () => {
      this._setState(PLAYER_STATE.BUFFERING);
      if (this.onBuffering) this.onBuffering(true, 50);
      this._resetWatchdog();
    };

    v.onplaying = () => {
      this._clearWatchdog();
      this._setState(PLAYER_STATE.PLAYING);
      if (this.onBuffering) this.onBuffering(false, 100);
    };

    v.onpause = () => {
      if (this.state !== PLAYER_STATE.STOPPED) {
        this._setState(PLAYER_STATE.PAUSED);
      }
    };

    v.ontimeupdate = () => {
      this.currentTime = v.currentTime;
      this.duration = v.duration || 0;
      if (this.onTimeUpdate) {
        this.onTimeUpdate(this.currentTime, this.duration);
      }
    };

    v.onerror = (e) => {
      const err = v.error;
      this._handleError({
        code: 'HTML5_VIDEO_ERROR',
        message: err ? `Video error code: ${err.code} (${err.message})` : 'HTML5 video playback error',
        fatal: true
      });
    };
  }

  // =========================================================================
  // UNIFIED CONTROLS: PLAY / PAUSE / STOP / SEEK / VOLUME
  // =========================================================================

  /**
   * Resumes or starts playback
   */
  play() {
    if (this.engine === PLAYER_ENGINE.AVPLAY && typeof window !== 'undefined' && window.webapis && window.webapis.avplay) {
      try {
        window.webapis.avplay.play();
        this._setState(PLAYER_STATE.PLAYING);
      } catch (err) {
        console.error('[player.js] AVPlay play error:', err);
      }
    } else if (this.videoElement) {
      this.videoElement.play().catch((err) => {
        // Autoplay policy or browser user interaction restriction
        console.warn('[player.js] Autoplay prevented, requires user click:', err.message);
      });
    }
  }

  /**
   * Pauses playback
   */
  pause() {
    if (this.engine === PLAYER_ENGINE.AVPLAY && typeof window !== 'undefined' && window.webapis && window.webapis.avplay) {
      try {
        window.webapis.avplay.pause();
        this._setState(PLAYER_STATE.PAUSED);
      } catch (err) {
        console.error('[player.js] AVPlay pause error:', err);
      }
    } else if (this.videoElement) {
      this.videoElement.pause();
      this._setState(PLAYER_STATE.PAUSED);
    }
  }

  /**
   * Toggles play / pause
   */
  togglePlay() {
    if (this.state === PLAYER_STATE.PLAYING) {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * Stops playback and resets state
   */
  stop() {
    this._clearWatchdog();

    if (this.engine === PLAYER_ENGINE.AVPLAY && typeof window !== 'undefined' && window.webapis && window.webapis.avplay) {
      try {
        const state = window.webapis.avplay.getState();
        if (state !== 'NONE' && state !== 'IDLE') {
          window.webapis.avplay.stop();
        }
      } catch (e) {
        // ignore
      }
    } else if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.removeAttribute('src');
      this.videoElement.load();
    }

    if (this.hls) {
      this.hls.stopLoad();
    }

    this._setState(PLAYER_STATE.STOPPED);
  }

  /**
   * Seeks to a specific timestamp in seconds
   * @param {number} seconds 
   */
  seek(seconds) {
    if (seconds < 0) seconds = 0;

    if (this.engine === PLAYER_ENGINE.AVPLAY && typeof window !== 'undefined' && window.webapis && window.webapis.avplay) {
      try {
        window.webapis.avplay.seekTo(
          seconds * 1000,
          () => { console.log(`[player.js] AVPlay seeked to ${seconds}s`); },
          (err) => { console.warn('[player.js] AVPlay seek error:', err); }
        );
      } catch (e) {
        console.warn('[player.js] Seek exception:', e);
      }
    } else if (this.videoElement) {
      this.videoElement.currentTime = seconds;
    }
  }

  /**
   * Sets volume level (0.0 to 1.0)
   * @param {number} level 
   */
  setVolume(level) {
    const clamped = Math.max(0, Math.min(1, level));
    this.volume = clamped;
    if (this.videoElement) {
      this.videoElement.volume = clamped;
    }
  }

  /**
   * Toggles mute state
   * @param {boolean} [mute] 
   */
  setMuted(mute) {
    this.isMuted = typeof mute === 'boolean' ? mute : !this.isMuted;
    if (this.videoElement) {
      this.videoElement.muted = this.isMuted;
    }
  }

  /**
   * Retrieves current active player engine
   * @returns {string}
   */
  getEngine() {
    return this.engine;
  }

  /**
   * Retrieves current playback state
   * @returns {string}
   */
  getState() {
    return this.state;
  }

  /**
   * Destroys the player instance, releases native hardware decoder resources, and detaches listeners
   */
  destroy() {
    this.stop();

    if (this.engine === PLAYER_ENGINE.AVPLAY && typeof window !== 'undefined' && window.webapis && window.webapis.avplay) {
      try {
        window.webapis.avplay.close();
      } catch (e) {
        // ignore
      }
    }

    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    if (this.videoElement) {
      this.videoElement.onwaiting = null;
      this.videoElement.onplaying = null;
      this.videoElement.onpause = null;
      this.videoElement.ontimeupdate = null;
      this.videoElement.onerror = null;
    }

    this._setState(PLAYER_STATE.IDLE);
    console.log('[player.js] UnifiedVideoPlayer destroyed.');
  }
}

export default UnifiedVideoPlayer;
