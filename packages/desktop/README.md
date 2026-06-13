# Cobalt (macOS App)

<div align="center">
    <br/>
    <p>
        <img src="../../web/static/favicon.png" title="Cobalt" alt="Cobalt logo" width="80" />
    </p>
    <p>
        <b>Cobalt</b> - A premium macOS media downloader desktop application powered by Cobalt Core.
        <br/>
        Friendly, efficient, beautiful glassmorphic UI, with zero ads, trackers, or paywalls.
    </p>
</div>

---

## 🌟 Key Features

* **Local Cobalt Core API Integration**: Spins up a local Cobalt API server inside the app, removing external API dependencies.
* **Premium Glassmorphic Design**: A modern, native-feeling macOS interface with vibrant themes, gradients, hover effects, and micro-animations.
* **Smart Drag & Drop**: Drag links directly from your browser's address bar to start downloading.
* **Clipboard Link Monitoring**: Detects copied media links in the clipboard and triggers one-click downloads.
* **Advanced Settings**: Customize download folders, default download modes (Video + Audio or Audio only), select max resolution, and choose preferred audio formats.
* **Task Management**: Parallel downloads list, real-time download speeds, progress trackers, and direct "Reveal in Finder" actions.

---

## 🌐 Supported Services

Cobalt inherits full download support from the **Cobalt API Core**. Below is the status of supported platforms:

| Service | Video + Audio | Audio Only | Video Only | Features & Notes |
| :--- | :---: | :---: | :---: | :--- |
| **YouTube** | ✅ | ✅ | ✅ | Supports Videos, Music, Shorts, 8K/4K/HDR/VR, high FPS, rich metadata, and multiple audio dubs. |
| **Bilibili** | ✅ | ✅ | ✅ | Download standard video streams and extracted audio clips. |
| **TikTok** | ✅ | ✅ | ✅ | Download videos with/without watermarks, slideshow images, and original audio files. |
| **Instagram** | ✅ | ✅ | ✅ | Supports Reels, Photos, and Videos. Choose contents from multi-media carousel posts. |
| **Twitter / X** | ✅ | ✅ | ✅ | Extract videos and photos directly from posts. |
| **SoundCloud** | ➖ | ✅ | ➖ | Extract audio directly (supports private links). |
| **Reddit** | ✅ | ✅ | ✅ | Supports GIFs and video posts. |
| **Vimeo** | ✅ | ✅ | ✅ | Full video resolution support. |
| **Bluesky** | ✅ | ✅ | ✅ | Extract video and media files from posts. |
| **Pinterest** | ✅ | ✅ | ✅ | Supports photos, gifs, videos, and stories. |
| **Snapchat** | ✅ | ✅ | ✅ | Supports spotlights and stories. |
| **Dailymotion** | ✅ | ✅ | ✅ | Includes rich metadata and filename naming styles. |
| **Loom** | ✅ | ❌ | ✅ | Fast screen recording links download. |
| **Streamable** | ✅ | ✅ | ✅ | Full high-quality web-hosted video downloads. |
| **Twitch** | ✅ | ✅ | ✅ | Extract clips and game streams. |

*Note: ✅ = Fully Supported | ➖ = Unreasonable/Not Applicable | ❌ = Not Supported.*

---

## 🛠️ Development & Building

To run or build the macOS application on your machine:

### 1. Requirements
Ensure you have **Node.js** and **pnpm** installed.

### 2. Run in Development Mode
```bash
# From the repository root
pnpm --filter @imput/cobalt-desktop dev
```
This spins up the Vite development server and opens the Electron wrapper with hot reload enabled.

### 3. Build Production DMG Package
```bash
# Build Svelte files and package the DMG installer
pnpm --filter @imput/cobalt-desktop build
```
The output will be saved in `packages/desktop/release/Cobalt-1.0.9-arm64.dmg`.

---

## 🔒 Resolving macOS Gatekeeper Warnings (Unverified Developer)

Since this app is built locally without Apple Developer ID signing, macOS Gatekeeper might block execution with a warning dialog. You can bypass this using one of the following methods:

* **Method 1 (Quick Context Menu)**:
  1. Open Finder and navigate to the application folder.
  2. **Right-click (Control-click)** the `Cobalt.app` file and select **Open**.
  3. Click **Open** on the prompt. macOS will remember your decision.
  
* **Method 2 (Terminal Command)**:
  Open Terminal and remove the quarantine flag using:
  ```bash
  xattr -cr /Applications/Cobalt.app
  ```
