<div align="center">
    <br/>
    <p>
        <img src="web/static/favicon.png" title="cobalt" alt="cobalt logo" width="100" />
    </p>
    <h1>Cobalt</h1>
    <p>
        The best way to save what you love — Friendly, efficient, ads-free media downloader.
        <br/>
        <a href="https://cobalt.tools">cobalt.tools</a>
    </p>
    <p>
        <a href="https://github.com/kresnikwang/cobalt-app/releases/latest">
            📦 <b>Download macOS App (v1.0.7)</b>
        </a>
        &nbsp;•&nbsp;
        <a href="https://kresnikwang.github.io/cobalt-app/">
            🌐 <b>Official Intro Website</b>
        </a>
    </p>
    <br/>
</div>

**Cobalt** is a media downloader that doesn't piss you off. It's friendly, efficient, and doesn't have ads, trackers, paywalls, or other nonsense. Paste the link, get the file, move on. That simple, just how it should be.

---

## 🌟 Cobalt (macOS Desktop App)

This repository features the **Cobalt** macOS desktop application—a premium Downie-like client powered by a local Cobalt Core API.

<div align="center">
    <img src="docs/images/desktop_preview.png" alt="Cobalt App Preview" width="550" style="border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 10px 30px rgba(0,0,0,0.3);" />
</div>

### Key Features
* ⚡ **Local API Integration**: Runs the Cobalt server locally in the main process. No dependencies on unstable public instances.
* 🔮 **Premium Glassmorphic UI**: Vibrant, responsive design matching native macOS aesthetics.
* 📂 **Task Scheduler**: Run parallel downloads with active slots, speed trackers, and progress meters.
* 📋 **Clipboard Monitoring**: Detects copied links and prompts you to download with one click.
* 🖱️ **Drag & Drop**: Drag address bar links from any browser directly into the app to start downloading.
* 🛡️ **Zero Tracking**: No telemetry, ads, trackers, or cookies collected.

### Resolving macOS Gatekeeper Warnings (Unverified Developer)
Since this build is compiled and packaged locally without Apple Developer ID signing, macOS might block launch. To open it:
1. Open Finder, **Right-click (Control-click)** `/Applications/Cobalt.app`, and select **Open**.
2. Alternatively, run this command in your Terminal:
   ```bash
   xattr -cr /Applications/Cobalt.app
   ```

---

## 📂 Monorepo Structure

This repository is managed as a pnpm monorepo containing:
* **`packages/desktop`**: The [macOS Desktop Client source & readme](/packages/desktop/)
* **`api`**: The [Cobalt API backend source & readme](/api/)
* **`web`**: The [Cobalt frontend web source & readme](/web/)
* **`packages/`**: Shared client libraries and version packages

---

## 🔒 Ethics & Disclaimer

Cobalt is a proxy tool that makes saving public content easier. It takes **zero liability**.
* The end-user is responsible for what they download, how they use and distribute that content.
* Cobalt never caches any content, it [works as a direct, fancy proxy stream](/api/src/stream/).
* It does not bypass DRM and only downloads publicly accessible, free media.

---

## 🤝 Contributing

If you'd like to contribute, check the [Contribution Guidelines](/CONTRIBUTING.md) to get started!

---

## 📄 License

Unless specified otherwise, the codebase is licensed under **AGPL-3.0**. Read [LICENSE](/LICENSE) for details.
