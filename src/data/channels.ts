/**
 * Sample IPTV Channels & Verified M3U8 Streams
 * Used for testing the UnifiedVideoPlayer module across live HLS test feeds.
 */

export interface Channel {
  id: string;
  name: string;
  category: 'Sports' | 'News' | 'Entertainment' | 'Documentary' | 'Movies';
  streamUrl: string;
  logo: string;
  currentProgram: string;
  nextProgram: string;
  quality: string;
  fps: number;
}

export const SAMPLE_CHANNELS: Channel[] = [
  {
    id: 'ch-1',
    name: 'Majd Sports HD 1',
    category: 'Sports',
    streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    logo: '⚽',
    currentProgram: 'UEFA Champions League: Matchday Highlights',
    nextProgram: 'Live Football Studio & Post-Game Analysis',
    quality: '1080p',
    fps: 60
  },
  {
    id: 'ch-2',
    name: 'Global News 24/7',
    category: 'News',
    streamUrl: 'https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8',
    logo: '🌍',
    currentProgram: 'World Financial & Geopolitical Report',
    nextProgram: 'International Weather & Breaking Headlines',
    quality: '1080p',
    fps: 50
  },
  {
    id: 'ch-3',
    name: 'Cinema Premiere HD',
    category: 'Movies',
    streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    logo: '🎬',
    currentProgram: 'Blockbuster Feature Film',
    nextProgram: 'Hollywood Backstage & Interviews',
    quality: '4K UHD',
    fps: 60
  },
  {
    id: 'ch-4',
    name: 'Geo Discovery HD',
    category: 'Documentary',
    streamUrl: 'https://playertest.longtailvideo.com/adaptive/oceans_aes/oceans_aes.m3u8',
    logo: '🐋',
    currentProgram: 'Ocean Mysteries: Deep Sea Ecosystems',
    nextProgram: 'Wild Africa: The Great Migration',
    quality: '1080p',
    fps: 60
  },
  {
    id: 'ch-5',
    name: 'Euro Action TV',
    category: 'Sports',
    streamUrl: 'https://test-streams.mux.dev/test_001/stream.m3u8',
    logo: '🏎️',
    currentProgram: 'Grand Prix Qualifying Session 2',
    nextProgram: 'Motorsport Weekly Digest',
    quality: '1080p',
    fps: 60
  },
  {
    id: 'ch-6',
    name: 'Space Explorer Stream',
    category: 'Documentary',
    streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    logo: '🚀',
    currentProgram: 'Deep Space Telescope Discoveries',
    nextProgram: 'Mars Rover Mission Update',
    quality: '1080p',
    fps: 30
  }
];
