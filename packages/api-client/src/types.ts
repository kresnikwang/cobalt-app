// @imput/cobalt-client — TypeScript SDK for the Cobalt API
// https://github.com/imputnet/cobalt

/** Supported video/audio quality levels */
export type CobaltVideoQuality = '144' | '240' | '360' | '480' | '720' | '1080' | '1440' | '2160' | 'max';

/** YouTube-specific video codec */
export type CobaltYouTubeVideoCodec = 'h264' | 'av1' | 'vp9';

/** YouTube container format */
export type CobaltYouTubeContainer = 'webm' | 'mp4';

/** Audio format */
export type CobaltAudioFormat = 'best' | 'mp3' | 'ogg' | 'wav' | 'opus' | 'm4a';

/** Audio bitrate in kbps */
export type CobaltAudioBitrate = '320' | '256' | '128' | '96' | '64' | '32' | '16' | '8';

/** Filename style */
export type CobaltFilenameStyle = 'classic' | 'basic' | 'pretty' | 'nerdy';

/** Download mode */
export type CobaltDownloadMode = 'auto' | 'audio' | 'mute';

/** Local processing mode */
export type CobaltLocalProcessing = 'disabled' | 'preferred' | 'forced';

// ─── Request ────────────────────────────────────────────

export interface CobaltSaveRequest {
    url: string;
    downloadMode?: CobaltDownloadMode;
    audioFormat?: CobaltAudioFormat;
    audioBitrate?: CobaltAudioBitrate;
    videoQuality?: CobaltVideoQuality;
    youtubeVideoCodec?: CobaltYouTubeVideoCodec;
    youtubeVideoContainer?: CobaltYouTubeContainer;
    youtubeDubLang?: string;
    youtubeBetterAudio?: boolean;
    youtubeHLS?: boolean;
    filenameStyle?: CobaltFilenameStyle;
    disableMetadata?: boolean;
    tiktokFullAudio?: boolean;
    allowH265?: boolean;
    convertGif?: boolean;
    subtitleLang?: string;
    alwaysProxy?: boolean;
    localProcessing?: CobaltLocalProcessing;
}

// ─── Response ───────────────────────────────────────────

export type CobaltResponseStatus = 'error' | 'picker' | 'redirect' | 'tunnel' | 'local-processing';

export interface CobaltErrorResponse {
    status: 'error';
    error: {
        code: string;
        context?: Record<string, unknown>;
    };
    critical?: boolean;
}

export interface CobaltPickerItem {
    type: 'photo' | 'video' | 'gif';
    url: string;
    thumb?: string;
}

export interface CobaltPickerResponse {
    status: 'picker';
    picker: CobaltPickerItem[];
    audio?: string;
    audioFilename?: string;
}

export interface CobaltRedirectResponse {
    status: 'redirect';
    url: string;
    filename: string;
}

export interface CobaltTunnelResponse {
    status: 'tunnel';
    url: string;
    filename: string;
}

export interface CobaltFileMetadata {
    album?: string;
    composer?: string;
    genre?: string;
    copyright?: string;
    title?: string;
    artist?: string;
    album_artist?: string;
    track?: string;
    date?: string;
    sublanguage?: string;
}

export interface CobaltLocalProcessingResponse {
    status: 'local-processing';
    type: 'merge' | 'mute' | 'audio' | 'gif' | 'remux' | 'proxy';
    service: string;
    tunnel: string[];
    output: {
        type: string;
        filename: string;
        metadata?: CobaltFileMetadata;
        subtitles?: boolean;
    };
    audio?: {
        copy: boolean;
        format: string;
        bitrate: string;
        cover?: boolean;
        cropCover?: boolean;
    };
    isHLS?: boolean;
}

export type CobaltAPIResponse =
    | CobaltErrorResponse
    | CobaltPickerResponse
    | CobaltRedirectResponse
    | CobaltTunnelResponse
    | CobaltLocalProcessingResponse;

// ─── Server Info ────────────────────────────────────────

export interface CobaltServerInfo {
    cobalt: {
        version: string;
        url: string;
        startTime: string;
        turnstileSitekey?: string;
        services: string[];
    };
    git: {
        branch: string;
        commit: string;
        remote: string;
    };
}

// ─── Session ────────────────────────────────────────────

export interface CobaltSession {
    token: string;
    exp: number;
}
