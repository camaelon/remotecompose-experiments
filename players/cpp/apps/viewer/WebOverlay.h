#pragma once

// An interactive web overlay for the presentation viewer: a real, clickable/scrollable
// WKWebView layered on top of the slide window (macOS). Lets a slide bring up a live URL
// mid-presentation and interact with the page. No-op stub on other platforms.

struct GLFWwindow;

// True while the overlay is currently shown.
bool webOverlayIsOpen();

// Show (or navigate) the overlay covering the window with `url`. Returns false if the
// overlay can't be created (bad URL / unsupported platform).
bool webOverlayShow(GLFWwindow* window, const char* url);

// Hide and destroy the overlay (safe to call when not open).
void webOverlayClose();

// Toggle: open with `url` if closed, else close.
void webOverlayToggle(GLFWwindow* window, const char* url);
