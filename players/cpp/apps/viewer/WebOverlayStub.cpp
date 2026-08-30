// Non-macOS fallback: no embedded web overlay. (A future port could shell out to the
// system browser here.)

#include "WebOverlay.h"

bool webOverlayIsOpen() { return false; }
bool webOverlayShow(GLFWwindow*, const char*) { return false; }
void webOverlayClose() {}
void webOverlayToggle(GLFWwindow*, const char*) {}
