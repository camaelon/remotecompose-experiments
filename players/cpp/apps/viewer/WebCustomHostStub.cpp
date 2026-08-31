// Non-macOS fallback: no embedded web views. (A future port could use a platform
// WebView2 / GTK WebKit here.)

#include "WebCustomHost.h"

void WebCustomHost::setWindow(GLFWwindow*) {}
void WebCustomHost::beginFrame() {}
void WebCustomHost::endFrame() {}
void WebCustomHost::reset() {}
bool WebCustomHost::drawCustom(int, const std::string&, rccore::PaintContext*,
                               float, float, double) { return false; }
