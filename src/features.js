"use strict";

const { app } = require("electron");

/**
 * Chromium switches that mirror the installed Microsoft Teams PWA:
 * pinch zoom, overscroll history, touch, PipeWire capture, no background
 * throttling (needed so presence heartbeats keep firing when occluded).
 */
function applyFeatureParity(config) {
  const features = [
    "OverlayScrollbar",
    "WebRTCPipeWireCapturer",
    "VaapiVideoDecoder",
    "VaapiVideoEncoder",
    "CanvasOopRasterization",
    "WebAuthentication",
    "WebAuthenticationPasskeys",
    "WebAuthenticationConditionalUI",
    "WebAuthenticationHybridDelegatedUI",
  ];

  if (config.features?.overscrollHistory !== false) {
    features.push("TouchpadOverscrollHistoryNavigation");
    features.push("OverscrollHistoryNavigation");
  }

  app.commandLine.appendSwitch("enable-features", features.join(","));
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  app.commandLine.appendSwitch("enable-smooth-scrolling");
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("enable-zero-copy");
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion,IdleDetection");

  if (config.features?.pinchZoom !== false) {
    app.commandLine.appendSwitch("enable-pinch");
  }
  if (config.features?.touchMode !== false) {
    app.commandLine.appendSwitch("touch-events", "enabled");
  }
  if (config.hardwareAcceleration === false) {
    app.disableHardwareAcceleration();
  }
}

module.exports = { applyFeatureParity };
