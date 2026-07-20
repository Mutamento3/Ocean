import { createRequire } from "node:module";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type NeteaseApi = typeof import("NeteaseCloudMusicApi");
type NeteaseResponse = { status: number; body: Record<string, unknown>; cookie: string[] };

const require = createRequire(import.meta.url);
const api = require("NeteaseCloudMusicApi") as NeteaseApi;

export interface MusicProfile {
  userId: number;
  nickname: string;
  avatarUrl?: string;
}

export interface MusicStatus {
  available: true;
  connected: boolean;
  provider: "netease-cloud-music";
  profile?: MusicProfile;
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

interface StoredMusicSession {
  cookie: string;
  profile?: MusicProfile;
  updatedAt: string;
}

const defaultSessionPath = () => join(process.cwd(), "server", "data", "netease-session.json");

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cookieHeader(parts: string[]) {
  return parts
    .map((part) => part.split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function profileFrom(body: Record<string, unknown>): MusicProfile | undefined {
  const data = record(body.data);
  const value = record(data.profile ?? body.profile);
  const userId = number(value.userId);
  if (!userId) return undefined;
  return {
    userId,
    nickname: String(value.nickname ?? "网易云用户"),
    avatarUrl: typeof value.avatarUrl === "string" ? value.avatarUrl : undefined,
  };
}

export class NeteaseMusicService {
  private session: StoredMusicSession | null = null;

  constructor(private readonly sessionPath = process.env.OCEAN_NETEASE_SESSION_PATH || defaultSessionPath()) {}

  async initialize() {
    try {
      const saved = JSON.parse(await readFile(this.sessionPath, "utf8")) as StoredMusicSession;
      this.session = saved.cookie ? saved : null;
    } catch {
      this.session = null;
    }
  }

  private async save(cookie: string, profile?: MusicProfile) {
    this.session = { cookie, profile, updatedAt: new Date().toISOString() };
    await mkdir(dirname(this.sessionPath), { recursive: true });
    await writeFile(this.sessionPath, JSON.stringify(this.session, null, 2), { encoding: "utf8", mode: 0o600 });
  }

  private async clear() {
    this.session = null;
    await unlink(this.sessionPath).catch(() => undefined);
  }

  private requireCookie() {
    if (!this.session?.cookie) throw new Error("netease_login_required");
    return this.session.cookie;
  }

  async status(refresh = false): Promise<MusicStatus> {
    if (!this.session?.cookie) return { available: true, connected: false, provider: "netease-cloud-music" };
    if (!refresh && this.session.profile) return { available: true, connected: true, provider: "netease-cloud-music", profile: this.session.profile };
    try {
      const response = await api.login_status({ cookie: this.session.cookie }) as NeteaseResponse;
      const profile = profileFrom(record(response.body));
      if (!profile) {
        await this.clear();
        return { available: true, connected: false, provider: "netease-cloud-music" };
      }
      await this.save(this.session.cookie, profile);
      return { available: true, connected: true, provider: "netease-cloud-music", profile };
    } catch {
      return { available: true, connected: true, provider: "netease-cloud-music", profile: this.session.profile };
    }
  }

  async createQr() {
    const keyResponse = await api.login_qr_key({}) as NeteaseResponse;
    const key = String(record(record(keyResponse.body).data).unikey ?? "");
    if (!key) throw new Error("netease_qr_key_unavailable");
    const qrResponse = await api.login_qr_create({ key, qrimg: true }) as NeteaseResponse;
    const data = record(record(qrResponse.body).data);
    const qrImage = typeof data.qrimg === "string" ? data.qrimg : "";
    const qrUrl = typeof data.qrurl === "string" ? data.qrurl : "";
    if (!qrImage) throw new Error("netease_qr_image_unavailable");
    return { key, qrImage, qrUrl, expiresInSeconds: 180 };
  }

  async checkQr(key: string) {
    if (!key || key.length > 180) throw new Error("netease_qr_key_invalid");
    const response = await api.login_qr_check({ key }) as NeteaseResponse;
    const body = record(response.body);
    const code = number(body.code);
    const state = code === 800 ? "expired" : code === 801 ? "waiting" : code === 802 ? "confirming" : code === 803 ? "authorized" : "error";
    if (state === "authorized") {
      const cookie = cookieHeader(response.cookie);
      if (!cookie) throw new Error("netease_login_cookie_missing");
      await this.save(cookie);
      const status = await this.status(true);
      return { state, code, message: String(body.message ?? "登录成功"), status };
    }
    return { state, code, message: String(body.message ?? "") };
  }

  async logout() {
    const cookie = this.session?.cookie;
    if (cookie) await api.logout({ cookie }).catch(() => undefined);
    await this.clear();
    return { connected: false };
  }

  async playlists(): Promise<MusicPlaylist[]> {
    const cookie = this.requireCookie();
    const status = await this.status();
    if (!status.profile) throw new Error("netease_profile_unavailable");
    const response = await api.user_playlist({ uid: status.profile.userId, limit: 60, offset: 0, cookie }) as NeteaseResponse;
    return list(record(response.body).playlist).map((raw) => {
      const item = record(raw);
      return {
        id: String(item.id ?? ""),
        name: String(item.name ?? "未命名歌单"),
        coverUrl: typeof item.coverImgUrl === "string" ? item.coverImgUrl : undefined,
        trackCount: number(item.trackCount),
        owned: number(item.userId) === status.profile!.userId,
      };
    }).filter((item) => item.id);
  }

  async tracks(playlistId: string): Promise<MusicTrack[]> {
    const cookie = this.requireCookie();
    if (!/^\d+$/.test(playlistId)) throw new Error("netease_playlist_id_invalid");
    const response = await api.playlist_track_all({ id: playlistId, limit: 500, offset: 0, cookie }) as NeteaseResponse;
    return list(record(response.body).songs).map((raw) => {
      const song = record(raw);
      const album = record(song.al);
      const id = String(song.id ?? "");
      return {
        id,
        name: String(song.name ?? "未命名歌曲"),
        artists: list(song.ar).map((artist) => String(record(artist).name ?? "")).filter(Boolean),
        album: typeof album.name === "string" ? album.name : undefined,
        coverUrl: typeof album.picUrl === "string" ? album.picUrl : undefined,
        durationMs: number(song.dt) || undefined,
        externalUrl: `https://music.163.com/song?id=${encodeURIComponent(id)}`,
      };
    }).filter((item) => item.id);
  }

  async playback(trackId: string, level = "standard") {
    const cookie = this.requireCookie();
    if (!/^\d+$/.test(trackId)) throw new Error("netease_track_id_invalid");
    const allowed = new Set(["standard", "exhigh", "lossless", "hires"]);
    const quality = allowed.has(level) ? level : "standard";
    const response = await api.song_url_v1({ id: trackId, level: quality as never, cookie }) as NeteaseResponse;
    const item = record(list(record(response.body).data)[0]);
    const url = typeof item.url === "string" ? item.url : "";
    return {
      trackId,
      playable: Boolean(url),
      url: url || undefined,
      level: String(item.level ?? quality),
      type: typeof item.type === "string" ? item.type : undefined,
      expiresAt: number(item.time) ? new Date(Date.now() + number(item.time) * 1000).toISOString() : undefined,
      externalUrl: `https://music.163.com/song?id=${encodeURIComponent(trackId)}`,
    };
  }
}
