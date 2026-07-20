export interface MusicProfile {
  userId: number;
  nickname: string;
  avatarUrl?: string;
}

export interface MusicStatus {
  available: boolean;
  connected: boolean;
  provider: "netease-cloud-music";
  profile?: MusicProfile;
}

export interface MusicQrLogin {
  key: string;
  qrImage: string;
  qrUrl?: string;
  expiresInSeconds: number;
}

export interface MusicQrState {
  state: "waiting" | "confirming" | "authorized" | "expired" | "error";
  code: number;
  message: string;
  status?: MusicStatus;
}

export interface MusicPlaylist {
  id: string;
  name: string;
  coverUrl?: string;
  trackCount: number;
  owned: boolean;
}

export interface MusicTrack {
  id: string;
  name: string;
  artists: string[];
  album?: string;
  coverUrl?: string;
  durationMs?: number;
  externalUrl: string;
}

export interface MusicPlayback {
  trackId: string;
  playable: boolean;
  url?: string;
  level: string;
  type?: string;
  expiresAt?: string;
  externalUrl: string;
}
