/**
 * App.tsx - MajdSat IPTV Single Page Application
 * Production Integration of auth.js, api.js, and player.js
 * 
 * Demonstrates:
 * 1. Hardware MAC Detection (Samsung Tizen, Android Interface, Web Hex ID)
 * 2. 10-Second Continuous Polling to https://player.majdsat.tn/api/check-device
 * 3. Automatic Transition to Home Dashboard on 'active' or 'trial'
 * 4. Unified AVPlay / HLS.js Video Streaming with robust error handling
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Tv,
  Radio,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  RefreshCw,
  Copy,
  Check,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Smartphone,
  Monitor,
  Code2,
  CheckCircle2,
  ChevronRight,
  Sparkles,
  Wifi,
  ExternalLink,
  Film,
  Info,
  Sliders,
  Settings,
  Layers,
  Flame
} from 'lucide-react';

// Core Logic Modules
import { getDeviceMac, getDeviceInfo, resetFallbackDeviceId, detectPlatform } from './modules/auth.js';
import { startDevicePolling, stopDevicePolling, checkDevice } from './modules/api.js';
import { UnifiedVideoPlayer, PLAYER_STATE, PLAYER_ENGINE } from './modules/player.js';

// Channels & Code References
import { SAMPLE_CHANNELS, Channel } from './data/channels';
import {
  AUTH_JS_CODE,
  API_JS_CODE,
  PLAYER_JS_CODE,
  TIZEN_CONFIG_XML,
  ANDROID_INTERFACE_JAVA
} from './data/moduleSources';

export default function App() {
  // Navigation / View State: 'activation' | 'dashboard' | 'code'
  const [currentView, setCurrentView] = useState<'activation' | 'dashboard' | 'code'>('activation');
  
  // Auth & Hardware State
  const [deviceMac, setDeviceMac] = useState<string>('');
  const [deviceInfo, setDeviceInfo] = useState<any>(null);
  const [simulatedPlatform, setSimulatedPlatform] = useState<string>('');
  const [copiedMac, setCopiedMac] = useState<boolean>(false);

  // API Polling State
  const [isPolling, setIsPolling] = useState<boolean>(true);
  const [pollCountdown, setPollCountdown] = useState<number>(10);
  const [pollCount, setPollCount] = useState<number>(0);
  const [deviceStatus, setDeviceStatus] = useState<'pending' | 'active' | 'trial' | 'expired' | 'error'>('pending');
  const [playlistUrl, setPlaylistUrl] = useState<string>('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8');
  const [lastPollTime, setLastPollTime] = useState<string>('Initializing...');
  const [lastErrorMsg, setLastErrorMsg] = useState<string | null>(null);

  // Player State
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerInstanceRef = useRef<UnifiedVideoPlayer | null>(null);

  const [activeChannel, setActiveChannel] = useState<Channel>(SAMPLE_CHANNELS[0]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [customStreamInput, setCustomStreamInput] = useState<string>('');
  const [playerState, setPlayerState] = useState<string>(PLAYER_STATE.IDLE);
  const [playerEngine, setPlayerEngine] = useState<string>('hlsjs');
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [bufferPercent, setBufferPercent] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(0.9);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '4:3' | 'fill'>('16:9');
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);

  // Code Viewer Tab
  const [codeTab, setCodeTab] = useState<'auth' | 'api' | 'player' | 'tizen' | 'android'>('auth');
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  // 1. Initialize Device Hardware Authentication (auth.js)
  useEffect(() => {
    const mac = getDeviceMac({ formatted: true });
    setDeviceMac(mac);
    setDeviceInfo(getDeviceInfo());
  }, []);

  // 2. Setup 10-Second API Polling (api.js)
  useEffect(() => {
    if (!deviceMac) return;

    // Countdown timer animation for the 10-second poll cycle
    const countdownInterval = setInterval(() => {
      setPollCountdown((prev) => (prev <= 1 ? 10 : prev - 1));
    }, 1000);

    // Start production polling from api.js
    const stopFn = startDevicePolling({
      mac: deviceMac,
      intervalMs: 10000,
      runImmediately: true,
      onStatusUpdate: (result: any) => {
        setPollCount(result.pollCount || 0);
        setLastPollTime(new Date().toLocaleTimeString());
        setPollCountdown(10);

        if (result.status === 'active' || result.status === 'trial') {
          setDeviceStatus(result.status);
          if (result.playlist_url) {
            setPlaylistUrl(result.playlist_url);
          }
          setLastErrorMsg(null);
        } else if (result.status === 'expired') {
          setDeviceStatus('expired');
          setLastErrorMsg('Subscription has expired. Please renew at provider portal.');
        } else if (result.status === 'error') {
          // If backend returns error / CORS in browser preview, report details
          setLastErrorMsg(result.error || 'Server connection attempt failed');
        }
      },
      onTransition: (data: any) => {
        console.log('[App.tsx] Received onTransition callback! Activating Home Dashboard.', data);
        setDeviceStatus(data.status);
        if (data.playlist_url) {
          setPlaylistUrl(data.playlist_url);
        }
        // Seamlessly transition to Home Dashboard view!
        setCurrentView('dashboard');
      },
      onError: (err: any) => {
        setLastErrorMsg(err.error || 'Network error connecting to https://player.majdsat.tn/api');
      }
    });

    setIsPolling(true);

    return () => {
      clearInterval(countdownInterval);
      stopFn();
      setIsPolling(false);
    };
  }, [deviceMac]);

  // 3. Initialize & Manage Unified Video Player (player.js)
  useEffect(() => {
    // Only initialize video player if on dashboard view
    if (currentView !== 'dashboard') {
      if (playerInstanceRef.current) {
        playerInstanceRef.current.destroy();
        playerInstanceRef.current = null;
      }
      return;
    }

    if (!videoRef.current) return;

    // Destroy existing player instance if any
    if (playerInstanceRef.current) {
      playerInstanceRef.current.destroy();
    }

    const player = new UnifiedVideoPlayer({
      videoElement: videoRef.current,
      containerElement: containerRef.current || undefined,
      autoPlay: true,
      timeoutMs: 12000,
      onStateChange: (state: string) => {
        setPlayerState(state);
        if (state === PLAYER_STATE.PLAYING) {
          setPlayerError(null);
        }
      },
      onBuffering: (buffering: boolean, percent: number) => {
        setIsBuffering(buffering);
        setBufferPercent(percent);
      },
      onTimeUpdate: (curr: number, dur: number) => {
        setCurrentTime(curr);
        setDuration(dur);
      },
      onError: (err: any) => {
        setPlayerError(err.message || 'Stream error encountered');
      },
      onReady: () => {
        setPlayerError(null);
      }
    });

    playerInstanceRef.current = player;
    setPlayerEngine(player.getEngine());

    // Load active channel stream
    player.load(activeChannel.streamUrl);

    return () => {
      player.destroy();
      playerInstanceRef.current = null;
    };
  }, [currentView, activeChannel]);

  // Handle Channel Selection
  const handleSelectChannel = (channel: Channel) => {
    setActiveChannel(channel);
    setPlayerError(null);
    if (playerInstanceRef.current) {
      playerInstanceRef.current.load(channel.streamUrl);
    }
  };

  // Handle Custom Stream Load
  const handleLoadCustomStream = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customStreamInput.trim()) return;

    const customChannel: Channel = {
      id: `custom-${Date.now()}`,
      name: 'Custom Stream Feed',
      category: 'Entertainment',
      streamUrl: customStreamInput.trim(),
      logo: '📡',
      currentProgram: 'Custom M3U8 Stream',
      nextProgram: 'Live Feed',
      quality: 'Auto',
      fps: 60
    };

    setActiveChannel(customChannel);
    if (playerInstanceRef.current) {
      playerInstanceRef.current.load(customStreamInput.trim());
    }
  };

  // Simulation Controls for Testing Module Logic
  const handleSimulateStatus = (status: 'active' | 'trial' | 'expired') => {
    stopDevicePolling();
    setIsPolling(false);
    setDeviceStatus(status);

    if (status === 'active' || status === 'trial') {
      const demoPlaylist = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
      setPlaylistUrl(demoPlaylist);
      // Trigger transition!
      setTimeout(() => {
        setCurrentView('dashboard');
      }, 350);
    } else {
      setLastErrorMsg('Account Expired: Please renew subscription via https://player.majdsat.tn');
    }
  };

  const handleResetMac = () => {
    const newMac = resetFallbackDeviceId();
    setDeviceMac(newMac);
    setDeviceInfo(getDeviceInfo());
    setDeviceStatus('pending');
    setPollCount(0);
  };

  const copyToClipboard = (text: string, isCode: boolean = false) => {
    navigator.clipboard.writeText(text);
    if (isCode) {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } else {
      setCopiedMac(true);
      setTimeout(() => setCopiedMac(false), 2000);
    }
  };

  const filteredChannels = selectedCategory === 'All' 
    ? SAMPLE_CHANNELS 
    : SAMPLE_CHANNELS.filter(c => c.category === selectedCategory);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans flex flex-col selection:bg-amber-500 selection:text-black">
      {/* Top Header Bar */}
      <header className="border-b border-neutral-800 bg-neutral-900/90 backdrop-blur sticky top-0 z-40 px-4 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center shadow-lg shadow-amber-500/20 text-neutral-950 font-black">
            <Tv className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold tracking-tight text-lg text-white">MAJDSAT</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                IPTV CORE
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 hidden sm:block">
              Cross-Platform Engine • Samsung Tizen OS & Android WebView
            </p>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <nav className="flex items-center bg-neutral-950/80 p-1 rounded-xl border border-neutral-800 text-xs font-medium">
          <button
            onClick={() => setCurrentView('activation')}
            className={`px-3.5 py-1.5 rounded-lg flex items-center gap-2 transition-all ${
              currentView === 'activation'
                ? 'bg-neutral-800 text-amber-400 shadow-sm font-semibold'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Device Activation
            {deviceStatus === 'active' && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>

          <button
            onClick={() => setCurrentView('dashboard')}
            className={`px-3.5 py-1.5 rounded-lg flex items-center gap-2 transition-all ${
              currentView === 'dashboard'
                ? 'bg-neutral-800 text-amber-400 shadow-sm font-semibold'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            Home Dashboard
          </button>

          <button
            onClick={() => setCurrentView('code')}
            className={`px-3.5 py-1.5 rounded-lg flex items-center gap-2 transition-all ${
              currentView === 'code'
                ? 'bg-neutral-800 text-amber-400 shadow-sm font-semibold'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            Module Sources
          </button>
        </nav>

        {/* Hardware Status Pill */}
        <div className="hidden md:flex items-center gap-2 text-xs bg-neutral-950/60 px-3 py-1.5 rounded-lg border border-neutral-800">
          <div className="flex items-center gap-1.5 text-neutral-400">
            {deviceInfo?.platform === 'tizen' ? (
              <Tv className="w-3.5 h-3.5 text-sky-400" />
            ) : deviceInfo?.platform === 'android' ? (
              <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Monitor className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span className="capitalize font-mono">{deviceInfo?.platform || 'web'}</span>
          </div>
          <span className="text-neutral-700">|</span>
          <span className="font-mono text-neutral-300 font-semibold">{deviceMac || 'Retrieving...'}</span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-4 lg:p-8 max-w-7xl mx-auto w-full">
        {/* ========================================================================= */}
        {/* VIEW 1: DEVICE ACTIVATION & POLLING (auth.js & api.js) */}
        {/* ========================================================================= */}
        {currentView === 'activation' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* TV-Ready Activation Box */}
            <div className="relative overflow-hidden rounded-3xl border border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-950 p-6 md:p-10 shadow-2xl">
              <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                {/* Left Column: MAC & Activation Info */}
                <div className="lg:col-span-7 space-y-6">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold">
                    <Sparkles className="w-3.5 h-3.5" />
                    Device Authentication Module (auth.js)
                  </div>

                  <div>
                    <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">
                      Device Authorization Required
                    </h1>
                    <p className="text-neutral-400 text-sm mt-2 leading-relaxed">
                      Your IPTV player is querying the live backend at{' '}
                      <code className="text-amber-300 bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-800">
                        https://player.majdsat.tn/api/check-device
                      </code>
                      . Provide your hardware MAC address below to your subscription provider to activate service.
                    </p>
                  </div>

                  {/* MAC Address Display Card */}
                  <div className="bg-neutral-950 p-5 rounded-2xl border border-neutral-800 space-y-3">
                    <div className="flex items-center justify-between text-xs text-neutral-400 font-medium">
                      <span>HARDWARE MAC / PERSISTENT DEVICE ID</span>
                      <span className="text-neutral-500 font-mono text-[11px]">
                        Storage: localStorage['majdsat_device_id']
                      </span>
                    </div>

                    <div className="flex items-center justify-between bg-neutral-900/80 px-4 py-3 rounded-xl border border-neutral-800 font-mono text-xl sm:text-2xl font-bold tracking-widest text-amber-400">
                      <span>{deviceMac || '00:00:00:00:00:00'}</span>
                      <button
                        onClick={() => copyToClipboard(deviceMac)}
                        className="text-xs font-sans font-medium px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 flex items-center gap-1.5 transition-all"
                      >
                        {copiedMac ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedMac ? 'Copied' : 'Copy'}
                      </button>
                    </div>

                    {/* Hardware Detection Breakdown */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 text-xs">
                      <div className={`p-2.5 rounded-lg border flex items-center gap-2 ${
                        deviceInfo?.platform === 'tizen'
                          ? 'border-sky-500/40 bg-sky-500/10 text-sky-300 font-semibold'
                          : 'border-neutral-800/80 bg-neutral-900/40 text-neutral-400'
                      }`}>
                        <Tv className="w-4 h-4 shrink-0" />
                        <div>
                          <div className="text-[11px] font-bold">1. Tizen API</div>
                          <div className="text-[10px] text-neutral-400 truncate">tizen.networkinfo</div>
                        </div>
                      </div>

                      <div className={`p-2.5 rounded-lg border flex items-center gap-2 ${
                        deviceInfo?.platform === 'android'
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-semibold'
                          : 'border-neutral-800/80 bg-neutral-900/40 text-neutral-400'
                      }`}>
                        <Smartphone className="w-4 h-4 shrink-0" />
                        <div>
                          <div className="text-[11px] font-bold">2. Android Interface</div>
                          <div className="text-[10px] text-neutral-400 truncate">AndroidInterface</div>
                        </div>
                      </div>

                      <div className={`p-2.5 rounded-lg border flex items-center gap-2 ${
                        deviceInfo?.platform === 'web'
                          ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 font-semibold'
                          : 'border-neutral-800/80 bg-neutral-900/40 text-neutral-400'
                      }`}>
                        <Monitor className="w-4 h-4 shrink-0" />
                        <div>
                          <div className="text-[11px] font-bold">3. Web Fallback</div>
                          <div className="text-[10px] text-neutral-400 truncate">12-char Hex ID</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions & Resets */}
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={handleResetMac}
                      className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-300 flex items-center gap-2 transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Regenerate Device ID
                    </button>

                    <a
                      href="https://player.majdsat.tn"
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-300 flex items-center gap-2 transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open MajdSat Portal
                    </a>
                  </div>
                </div>

                {/* Right Column: Live Polling Engine Indicator (api.js) */}
                <div className="lg:col-span-5 bg-neutral-950 p-6 rounded-2xl border border-neutral-800 flex flex-col items-center text-center space-y-5">
                  <div className="w-full flex items-center justify-between text-xs text-neutral-400">
                    <span className="font-semibold text-neutral-300 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      10s Polling Cycle (api.js)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${isPolling ? 'bg-amber-400 animate-ping' : 'bg-neutral-600'}`} />
                      {isPolling ? 'Active' : 'Stopped'}
                    </span>
                  </div>

                  {/* Circular Timer / Countdown UI */}
                  <div className="relative w-36 h-36 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        className="stroke-neutral-800 fill-none"
                        strokeWidth="8"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        className="stroke-amber-500 fill-none transition-all duration-1000 ease-linear"
                        strokeWidth="8"
                        strokeDasharray={264}
                        strokeDashoffset={264 - (264 * pollCountdown) / 10}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute flex flex-col items-center">
                      <span className="text-3xl font-black font-mono text-white">{pollCountdown}s</span>
                      <span className="text-[10px] text-neutral-400 uppercase tracking-wider">Next Poll</span>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div className="w-full bg-neutral-900/90 p-3.5 rounded-xl border border-neutral-800 space-y-1">
                    <div className="text-[11px] text-neutral-400 font-medium uppercase tracking-wider">Backend Status</div>
                    <div className="flex items-center justify-center gap-2">
                      {deviceStatus === 'active' ? (
                        <span className="text-emerald-400 font-bold text-base flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" /> ACTIVE SUBSCRIPTION
                        </span>
                      ) : deviceStatus === 'trial' ? (
                        <span className="text-sky-400 font-bold text-base flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4" /> TRIAL PERIOD
                        </span>
                      ) : deviceStatus === 'expired' ? (
                        <span className="text-rose-400 font-bold text-base flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4" /> EXPIRED ACCOUNT
                        </span>
                      ) : (
                        <span className="text-amber-400 font-bold text-base flex items-center gap-1.5">
                          <RefreshCw className="w-4 h-4 animate-spin" /> WAITING FOR ACTIVATION
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-neutral-400 font-mono">
                      Checks sent: {pollCount} | Last ping: {lastPollTime}
                    </div>
                  </div>

                  {/* Error Notification if any */}
                  {lastErrorMsg && (
                    <div className="w-full text-left text-xs bg-rose-500/10 border border-rose-500/20 text-rose-300 p-2.5 rounded-lg flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <div className="break-words leading-tight">{lastErrorMsg}</div>
                    </div>
                  )}

                  {/* Auto Transition Description */}
                  <div className="text-xs text-neutral-400 leading-normal">
                    ⚡ Once the server returns <span className="text-emerald-400 font-semibold">"active"</span> or{' '}
                    <span className="text-sky-400 font-semibold">"trial"</span>, the interval will automatically clear and redirect to the Home Dashboard.
                  </div>
                </div>
              </div>
            </div>

            {/* Developer Simulation Bar */}
            <div className="bg-neutral-900/70 border border-neutral-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-amber-400" />
                  Testing & Logic Verification Panel
                </span>
                <span className="text-xs text-neutral-400">Simulate server response or navigate to dashboard</span>
              </div>

              <div className="flex flex-wrap gap-2.5">
                <button
                  onClick={() => handleSimulateStatus('active')}
                  className="px-3.5 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Simulate Server: Active (Transitions to Dashboard)
                </button>

                <button
                  onClick={() => handleSimulateStatus('trial')}
                  className="px-3.5 py-2 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-300 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Simulate Server: Trial (Transitions to Dashboard)
                </button>

                <button
                  onClick={() => handleSimulateStatus('expired')}
                  className="px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Simulate Server: Expired
                </button>

                <button
                  onClick={() => {
                    checkDevice(deviceMac).then((res) => {
                      alert(`Live Server Response:\n${JSON.stringify(res, null, 2)}`);
                    });
                  }}
                  className="px-3.5 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 text-xs font-medium flex items-center gap-1.5 transition ml-auto"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Single One-Off Ping (https://player.majdsat.tn/api)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 2: HOME DASHBOARD & UNIFIED VIDEO PLAYER (player.js) */}
        {/* ========================================================================= */}
        {currentView === 'dashboard' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Top Status Banner */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl px-5 py-3 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
                  {deviceStatus === 'trial' ? 'TRIAL ACCOUNT' : 'PREMIUM SUBSCRIPTION ACTIVE'}
                </span>
                <span className="text-xs font-mono text-neutral-500">| MAC: {deviceMac}</span>
              </div>

              <div className="flex items-center gap-3 text-xs">
                <span className="px-2.5 py-1 rounded-md bg-neutral-950 border border-neutral-800 text-neutral-300 font-mono">
                  Engine: <span className="text-amber-400 font-bold uppercase">{playerEngine}</span>
                </span>
                <button
                  onClick={() => setShowDiagnostics(!showDiagnostics)}
                  className="px-3 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition"
                >
                  {showDiagnostics ? 'Hide Diagnostics' : 'Stream Diagnostics'}
                </button>
              </div>
            </div>

            {/* Main IPTV Grid: Video Player + EPG Guide */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Player Viewport & Controls (8 cols) */}
              <div className="lg:col-span-8 space-y-4">
                <div
                  ref={containerRef}
                  className={`relative w-full rounded-2xl overflow-hidden bg-black border border-neutral-800 shadow-2xl transition-all ${
                    aspectRatio === '16:9' ? 'aspect-video' : aspectRatio === '4:3' ? 'aspect-[4/3]' : 'aspect-video'
                  }`}
                >
                  {/* HTML5 Video Element (Mounted for HLS.js / HTML5) */}
                  <video
                    ref={videoRef}
                    className="w-full h-full object-contain bg-black"
                    playsInline
                    autoPlay
                    muted={isMuted}
                  />

                  {/* Buffering Indicator Overlay */}
                  {isBuffering && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex flex-col items-center justify-center gap-2 pointer-events-none z-20">
                      <div className="w-10 h-10 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs font-mono text-amber-400 font-semibold">
                        Buffering {bufferPercent > 0 ? `${bufferPercent}%` : ''}
                      </span>
                    </div>
                  )}

                  {/* Player Error Overlay */}
                  {playerError && (
                    <div className="absolute inset-0 bg-neutral-950/90 flex flex-col items-center justify-center p-6 text-center z-25 gap-3">
                      <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center">
                        <AlertTriangle className="w-6 h-6" />
                      </div>
                      <div className="text-base font-bold text-white">Stream Playback Interrupted</div>
                      <p className="text-xs text-neutral-400 max-w-md">{playerError}</p>
                      <button
                        onClick={() => {
                          setPlayerError(null);
                          if (playerInstanceRef.current) {
                            playerInstanceRef.current.load(activeChannel.streamUrl);
                          }
                        }}
                        className="px-4 py-2 rounded-xl bg-amber-500 text-neutral-950 font-bold text-xs flex items-center gap-1.5 hover:bg-amber-400 transition"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Reload Stream Watchdog
                      </button>
                    </div>
                  )}

                  {/* Top Video Overlay: Current Channel Badge */}
                  <div className="absolute top-4 left-4 z-10 flex items-center gap-2 pointer-events-none">
                    <div className="px-3 py-1.5 rounded-lg bg-neutral-950/80 backdrop-blur border border-neutral-700/60 flex items-center gap-2 shadow-lg">
                      <span className="text-lg">{activeChannel.logo}</span>
                      <span className="font-bold text-sm text-white tracking-wide">{activeChannel.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold">
                        {activeChannel.quality} {activeChannel.fps}fps
                      </span>
                    </div>

                    <div className="px-2.5 py-1.5 rounded-lg bg-neutral-950/80 backdrop-blur border border-neutral-700/60 text-[10px] font-mono text-neutral-300">
                      LIVE HLS
                    </div>
                  </div>

                  {/* Bottom Video Controls Overlay */}
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-4 z-10 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          if (playerInstanceRef.current) {
                            playerInstanceRef.current.togglePlay();
                          }
                        }}
                        className="w-10 h-10 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 flex items-center justify-center font-bold shadow-lg transition"
                      >
                        {playerState === PLAYER_STATE.PLAYING ? (
                          <Pause className="w-5 h-5 fill-current" />
                        ) : (
                          <Play className="w-5 h-5 fill-current ml-0.5" />
                        )}
                      </button>

                      {/* Mute / Unmute */}
                      <button
                        onClick={() => {
                          const nextMute = !isMuted;
                          setIsMuted(nextMute);
                          if (playerInstanceRef.current) {
                            playerInstanceRef.current.setMuted(nextMute);
                          }
                        }}
                        className="w-9 h-9 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 flex items-center justify-center transition"
                      >
                        {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
                      </button>

                      {/* Volume Slider */}
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={isMuted ? 0 : volume}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setVolume(val);
                          setIsMuted(val === 0);
                          if (playerInstanceRef.current) {
                            playerInstanceRef.current.setVolume(val);
                          }
                        }}
                        className="w-20 accent-amber-500 cursor-pointer hidden sm:block"
                      />

                      <div className="text-xs font-mono text-neutral-300 hidden sm:block">
                        {Math.floor(currentTime)}s / {duration > 0 ? `${Math.floor(duration)}s` : 'LIVE'}
                      </div>
                    </div>

                    {/* Right Controls: Aspect Ratio & Fullscreen */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center bg-neutral-800/80 rounded-lg p-0.5 text-[11px] font-semibold text-neutral-300">
                        <button
                          onClick={() => setAspectRatio('16:9')}
                          className={`px-2 py-1 rounded ${aspectRatio === '16:9' ? 'bg-amber-500 text-neutral-950' : ''}`}
                        >
                          16:9
                        </button>
                        <button
                          onClick={() => setAspectRatio('4:3')}
                          className={`px-2 py-1 rounded ${aspectRatio === '4:3' ? 'bg-amber-500 text-neutral-950' : ''}`}
                        >
                          4:3
                        </button>
                      </div>

                      <button
                        onClick={() => {
                          if (!containerRef.current) return;
                          if (!document.fullscreenElement) {
                            containerRef.current.requestFullscreen?.();
                          } else {
                            document.exitFullscreen?.();
                          }
                        }}
                        className="w-9 h-9 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 flex items-center justify-center transition"
                        title="Toggle Fullscreen"
                      >
                        <Maximize2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Stream Telemetry Diagnostics Box */}
                {showDiagnostics && (
                  <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-4 space-y-2 text-xs font-mono">
                    <div className="text-neutral-400 font-bold flex items-center gap-2">
                      <Info className="w-3.5 h-3.5 text-amber-400" />
                      UNIFIED PLAYER DIAGNOSTIC METRICS
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-neutral-300">
                      <div>State: <span className="text-amber-400">{playerState}</span></div>
                      <div>Engine: <span className="text-sky-400">{playerEngine}</span></div>
                      <div>Watchdog: <span className="text-emerald-400">12,000ms</span></div>
                      <div>Current Time: <span>{currentTime.toFixed(2)}s</span></div>
                    </div>
                    <div className="text-[11px] text-neutral-500 truncate pt-1">
                      Stream Source: {activeChannel.streamUrl}
                    </div>
                  </div>
                )}

                {/* Custom M3U8 Stream Input Bar */}
                <form
                  onSubmit={handleLoadCustomStream}
                  className="bg-neutral-900 border border-neutral-800 rounded-2xl p-3 flex items-center gap-2"
                >
                  <span className="text-xs text-neutral-400 font-semibold px-2 shrink-0">Custom M3U8:</span>
                  <input
                    type="url"
                    value={customStreamInput}
                    onChange={(e) => setCustomStreamInput(e.target.value)}
                    placeholder="https://example.com/playlist.m3u8"
                    className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs shrink-0 transition"
                  >
                    Play Stream
                  </button>
                </form>
              </div>

              {/* Right Column: IPTV Channel EPG Guide (4 cols) */}
              <div className="lg:col-span-4 bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex flex-col h-[600px]">
                <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
                  <div className="flex items-center gap-2">
                    <Film className="w-4 h-4 text-amber-400" />
                    <span className="font-extrabold text-sm tracking-wide text-white">LIVE CHANNELS</span>
                  </div>
                  <span className="text-xs text-neutral-400 font-mono">{filteredChannels.length} Feeds</span>
                </div>

                {/* Category Filters */}
                <div className="flex items-center gap-1.5 py-3 overflow-x-auto no-scrollbar">
                  {['All', 'Sports', 'News', 'Movies', 'Documentary'].map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                        selectedCategory === cat
                          ? 'bg-amber-500 text-neutral-950'
                          : 'bg-neutral-950 text-neutral-400 hover:text-white border border-neutral-800'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Channel List */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1 pt-1">
                  {filteredChannels.map((channel) => {
                    const isSelected = activeChannel.id === channel.id;
                    return (
                      <button
                        key={channel.id}
                        onClick={() => handleSelectChannel(channel)}
                        className={`w-full text-left p-3 rounded-xl border transition-all flex items-start gap-3 ${
                          isSelected
                            ? 'bg-amber-500/10 border-amber-500/40 text-white shadow-lg'
                            : 'bg-neutral-950/70 border-neutral-800/80 text-neutral-300 hover:bg-neutral-800/50'
                        }`}
                      >
                        <span className="text-2xl pt-0.5">{channel.logo}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-bold text-xs truncate">{channel.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 font-mono">
                              {channel.quality}
                            </span>
                          </div>
                          <p className="text-[11px] text-amber-400/90 truncate mt-0.5">
                            ▶ {channel.currentProgram}
                          </p>
                          <p className="text-[10px] text-neutral-500 truncate">
                            Next: {channel.nextProgram}
                          </p>
                        </div>
                        {isSelected && (
                          <div className="pt-2">
                            <span className="w-2 h-2 rounded-full bg-amber-400 block animate-ping" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 3: MODULE SOURCE VIEWER & EXPORT (auth.js, api.js, player.js) */}
        {/* ========================================================================= */}
        {currentView === 'code' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 md:p-8 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black text-white flex items-center gap-2">
                    <Code2 className="w-6 h-6 text-amber-400" />
                    Production Core Modules
                  </h2>
                  <p className="text-neutral-400 text-xs mt-1">
                    Exportable JavaScript modules written specifically for Samsung Tizen OS, Android WebView, and Web.
                  </p>
                </div>

                {/* Copy Button */}
                <button
                  onClick={() => {
                    const codeMap: Record<string, string> = {
                      auth: AUTH_JS_CODE,
                      api: API_JS_CODE,
                      player: PLAYER_JS_CODE,
                      tizen: TIZEN_CONFIG_XML,
                      android: ANDROID_INTERFACE_JAVA
                    };
                    copyToClipboard(codeMap[codeTab], true);
                  }}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs flex items-center gap-1.5 transition"
                >
                  {copiedCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copiedCode ? 'Copied to Clipboard!' : `Copy ${codeTab.toUpperCase()}`}
                </button>
              </div>

              {/* Module Tabs */}
              <div className="flex flex-wrap gap-2 border-b border-neutral-800 pb-3">
                <button
                  onClick={() => setCodeTab('auth')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                    codeTab === 'auth'
                      ? 'bg-amber-500 text-neutral-950 shadow-md'
                      : 'bg-neutral-950 text-neutral-400 hover:text-white border border-neutral-800'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  1. auth.js (Hardware MAC)
                </button>

                <button
                  onClick={() => setCodeTab('api')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                    codeTab === 'api'
                      ? 'bg-amber-500 text-neutral-950 shadow-md'
                      : 'bg-neutral-950 text-neutral-400 hover:text-white border border-neutral-800'
                  }`}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  2. api.js (10s Polling)
                </button>

                <button
                  onClick={() => setCodeTab('player')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                    codeTab === 'player'
                      ? 'bg-amber-500 text-neutral-950 shadow-md'
                      : 'bg-neutral-950 text-neutral-400 hover:text-white border border-neutral-800'
                  }`}
                >
                  <Tv className="w-3.5 h-3.5" />
                  3. player.js (AVPlay & HLS)
                </button>

                <button
                  onClick={() => setCodeTab('tizen')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                    codeTab === 'tizen'
                      ? 'bg-amber-500 text-neutral-950 shadow-md'
                      : 'bg-neutral-950 text-neutral-400 hover:text-white border border-neutral-800'
                  }`}
                >
                  <Settings className="w-3.5 h-3.5" />
                  Tizen config.xml
                </button>

                <button
                  onClick={() => setCodeTab('android')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                    codeTab === 'android'
                      ? 'bg-amber-500 text-neutral-950 shadow-md'
                      : 'bg-neutral-950 text-neutral-400 hover:text-white border border-neutral-800'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  Android Interface (Java)
                </button>
              </div>

              {/* Code Pre Box */}
              <div className="relative rounded-2xl bg-neutral-950 border border-neutral-800 p-4 overflow-x-auto max-h-[550px]">
                <pre className="font-mono text-xs text-neutral-300 leading-relaxed">
                  {codeTab === 'auth' && AUTH_JS_CODE}
                  {codeTab === 'api' && API_JS_CODE}
                  {codeTab === 'player' && PLAYER_JS_CODE}
                  {codeTab === 'tizen' && TIZEN_CONFIG_XML}
                  {codeTab === 'android' && ANDROID_INTERFACE_JAVA}
                </pre>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-800 bg-neutral-950 py-4 px-6 text-center text-xs text-neutral-500">
        MajdSat IPTV Engine • Backend Endpoint:{' '}
        <code className="text-amber-400 font-mono">https://player.majdsat.tn/api</code> • Built for Samsung Tizen OS, Android & Web
      </footer>
    </div>
  );
}
